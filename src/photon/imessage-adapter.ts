import type {
  CreateAvailabilityPollRequest,
  CreateAvailabilityPollResponse,
  ParticipantSnapshot,
  PollVoteEvent,
} from "../contracts/types.js";

/**
 * Photon iMessage poll surface (advanced-imessage-kit).
 *
 * This is the seam RocketRide drives for outbound poll create + inbound votes.
 * Inbound *text* arrives separately via the Spectrum webhook.
 */
export interface PollAdapter {
  /** Create a native availability poll in the target chat. */
  createPoll(
    request: CreateAvailabilityPollRequest,
  ): Promise<CreateAvailabilityPollResponse>;

  /**
   * Participant snapshot for a chat at poll-creation time.
   * Becomes the denominator for completion ("all voted") and pending set.
   */
  getParticipants(chatGuid: string): Promise<ParticipantSnapshot[]>;

  /** Contacts name map: handle (phone/email) -> display name. */
  getContactNameMap(): Promise<Map<string, string>>;

  /** Subscribe to normalized native poll-vote events. Returns an unsubscribe fn. */
  onVote(handler: (event: PollVoteEvent) => void): () => void;

  /** Optional lifecycle (real adapter connects a socket; mock is a no-op). */
  connect?(): Promise<void>;
  close?(): Promise<void>;
}
