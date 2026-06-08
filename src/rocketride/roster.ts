import {
  AvailabilitySchema,
  type Availability,
  type PollVoteRecord,
  type RosterUser,
  type UserRoster,
} from "../contracts/types.js";

/**
 * Build the terminal UserRoster artifact (Step 4).
 *
 * A user appears when they are a group participant AND cast a vote. Their
 * `availability` carries the actual vote; non-voters are excluded here
 * (tracked separately in Butterbase as status="pending").
 */

export interface BuildRosterInput {
  correlationId: string;
  tripId: string;
  pollId: string;
  votes: PollVoteRecord[];
  /** handle -> display name (from contacts) */
  nameMap: Map<string, string>;
  /** participant set captured at poll creation (the denominator) */
  participantSnapshot: string[];
  /** false on timeout with <100% votes (PARTIAL_ROSTER) */
  complete: boolean;
}

export function buildRoster(input: BuildRosterInput): UserRoster {
  const snapshot = new Set(input.participantSnapshot);

  const users: RosterUser[] = input.votes
    // Only include voters who are participants in the target chat.
    .filter((v) => snapshot.size === 0 || snapshot.has(v.participant_handle))
    .map((vote) => ({
      name: input.nameMap.get(vote.participant_handle) ?? vote.participant_handle,
      phone_number: normalizeE164(vote.participant_handle),
      availability: toAvailability(vote.option_text),
    }));

  return {
    correlation_id: input.correlationId,
    trip_id: input.tripId,
    poll_id: input.pollId,
    generated_at: new Date().toISOString(),
    complete: input.complete,
    users,
  };
}

export function toAvailability(optionText: string): Availability {
  const parsed = AvailabilitySchema.safeParse(optionText.toLowerCase());
  if (!parsed.success) {
    throw new Error(`unexpected option_text: ${optionText}`);
  }
  return parsed.data;
}

/** Best-effort E.164 normalization for iMessage handles. */
export function normalizeE164(handle: string): string {
  // Email-style handles (iMessage allows them) pass through unchanged.
  if (handle.includes("@")) return handle;
  const digits = handle.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : handle;
}
