import { z } from "zod";

/**
 * Contract types + runtime schemas for the
 * Intent Classification -> Availability Poll -> User Roster integration.
 *
 * Source of truth: docs/contracts/intent-to-poll-integration.md
 */

export const PLATFORM = "imessage" as const;

export const AvailabilitySchema = z.enum(["yes", "no"]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const OptionTextSchema = z.enum(["Yes", "No"]);
export type OptionText = z.infer<typeof OptionTextSchema>;

export const POLL_OPTIONS: OptionText[] = ["Yes", "No"];

// --- Step 0: IntentEvent (XTrace upsert to Butterbase) ---

export const IntentEventSchema = z.object({
  id: z.string().optional(),
  message_id: z.string(),
  channel: z.string(),
  chat_id: z.string(),
  chat_name: z.string().nullable().optional(),
  chat_kind: z.string().nullable().optional(),
  sender: z.string().nullable().optional(),
  is_from_me: z.boolean().nullable().optional(),
  text: z.string(),
  context_window: z.string().nullable().optional(),
  is_travel_intent: z.boolean(),
  confidence: z.number().min(0).max(1),
  location: z.string().nullable().optional(),
  created_at: z.string(),
});
export type IntentEvent = z.infer<typeof IntentEventSchema>;

// --- Step 1: Intent classification input (normalized internal shape) ---

export const TravelIntentSignalSchema = z.enum([
  "explicit_planning",
  "destination_mention",
  "date_mention",
  "mixed",
]);
export type TravelIntentSignal = z.infer<typeof TravelIntentSignalSchema>;

export const IntentClassificationResultSchema = z.object({
  message_id: z.string(),
  chat_guid: z.string(),
  platform: z.literal(PLATFORM),
  text: z.string(),
  classified_at: z.string(),
  travel_intent: z.object({
    detected: z.boolean(),
    confidence: z.number().min(0).max(1),
    signal: TravelIntentSignalSchema,
  }),
  extracted: z.object({
    destination: z.string().nullable(),
    timeframe: z.string().nullable(),
    participants_mentioned: z.array(z.string()),
  }),
  should_orchestrate: z.boolean(),
});
export type IntentClassificationResult = z.infer<
  typeof IntentClassificationResultSchema
>;

// --- Step 2: Create availability poll ---

export const PollKindSchema = z.literal("availability");
export type PollKind = z.infer<typeof PollKindSchema>;

export const CreateAvailabilityPollRequestSchema = z.object({
  correlation_id: z.string(),
  trip_id: z.string().nullable(),
  target: z.object({
    chat_guid: z.string(),
    platform: z.literal(PLATFORM),
  }),
  poll: z.object({
    title: z.string(),
    options: z.array(z.string()).min(2),
    kind: PollKindSchema,
  }),
  context: z.object({
    destination: z.string().nullable(),
    timeframe: z.string().nullable(),
    trigger_message_id: z.string(),
  }),
});
export type CreateAvailabilityPollRequest = z.infer<
  typeof CreateAvailabilityPollRequestSchema
>;

export const CreateAvailabilityPollResponseSchema = z.object({
  correlation_id: z.string(),
  poll_id: z.string(),
  external_poll_guid: z.string(),
  status: z.enum(["sent", "failed"]),
  sent_at: z.string(),
  error: z.string().nullable(),
});
export type CreateAvailabilityPollResponse = z.infer<
  typeof CreateAvailabilityPollResponseSchema
>;

// --- Step 3: Vote collection ---

/** Native iMessage poll vote event (as parsed from advanced-imessage-kit). */
export const PollVoteEventSchema = z.object({
  event: z.literal("poll_vote"),
  poll_message_guid: z.string(),
  chat_guid: z.string(),
  votes: z.array(
    z.object({
      participant_handle: z.string(),
      option_identifier: z.string(),
      option_text: z.string(),
    }),
  ),
});
export type PollVoteEvent = z.infer<typeof PollVoteEventSchema>;

/** Normalized, persisted vote (first-vote-wins). */
export const PollVoteRecordSchema = z.object({
  poll_id: z.string(),
  participant_handle: z.string(),
  option_identifier: z.string(),
  option_text: OptionTextSchema,
  voted_at: z.string(),
});
export type PollVoteRecord = z.infer<typeof PollVoteRecordSchema>;

export const PollCompletedReasonSchema = z.enum(["all_voted", "timeout"]);
export type PollCompletedReason = z.infer<typeof PollCompletedReasonSchema>;

export const PollCompletedEventSchema = z.object({
  poll_id: z.string(),
  reason: PollCompletedReasonSchema,
  completed_at: z.string(),
});
export type PollCompletedEvent = z.infer<typeof PollCompletedEventSchema>;

// --- Step 4: User roster (terminal artifact) ---

export const RosterUserSchema = z.object({
  name: z.string(),
  phone_number: z.string(),
  availability: AvailabilitySchema,
});
export type RosterUser = z.infer<typeof RosterUserSchema>;

export const UserRosterSchema = z.object({
  correlation_id: z.string(),
  trip_id: z.string(),
  poll_id: z.string(),
  generated_at: z.string(),
  complete: z.boolean(),
  users: z.array(RosterUserSchema),
});
export type UserRoster = z.infer<typeof UserRosterSchema>;

// --- Error contract ---

export const ERROR_CODES = {
  INTENT_GATE_FAILED: "INTENT_GATE_FAILED",
  CHAT_RESOLUTION_FAILED: "CHAT_RESOLUTION_FAILED",
  MISSING_CHAT_GUID: "MISSING_CHAT_GUID",
  POLL_SEND_FAILED: "POLL_SEND_FAILED",
  PARTIAL_ROSTER: "PARTIAL_ROSTER",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class ContractError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

// --- Shared supporting shapes ---

/** A participant captured in the poll-creation snapshot. */
export interface ParticipantSnapshot {
  handle: string;
}

/** Inbound message normalized off the Spectrum webhook. */
export interface InboundMessage {
  messageId: string;
  chatGuid: string;
  text: string;
  platform: typeof PLATFORM;
}
