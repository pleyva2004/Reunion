import {
  OptionTextSchema,
  type OptionText,
  type PollVoteEvent,
  type PollVoteRecord,
} from "../contracts/types.js";
import type { Store } from "../butterbase/store.js";
import { STAGES, stage } from "../observability/logger.js";

export interface NormalizedVote {
  record: PollVoteRecord;
  inserted: boolean;
}

export async function normalizeVoteEvent(
  event: PollVoteEvent,
  store: Store,
): Promise<NormalizedVote[]> {
  const poll = await store.findPollByExternalGuid(event.poll_message_guid);
  if (!poll) return [];

  const out: NormalizedVote[] = [];
  const votedAt = new Date().toISOString();

  for (const v of event.votes) {
    const optionText = coerceOptionText(v.option_text);
    if (!optionText) continue;

    const record: PollVoteRecord = {
      poll_id: poll.id,
      participant_handle: v.participant_handle,
      option_identifier: v.option_identifier,
      option_text: optionText,
      voted_at: votedAt,
    };

    const inserted = await store.insertVoteIfAbsent(record);
    if (inserted) {
      await store.markParticipantVoted(poll.tripId, v.participant_handle);
      stage(STAGES.POLL_VOTE_RECEIVED, {
        poll_id: poll.id,
        participant_handle: v.participant_handle,
        option_text: optionText,
      });
    } else {
      stage(STAGES.VOTE_IGNORED, {
        poll_id: poll.id,
        participant_handle: v.participant_handle,
        option_text: optionText,
      });
    }
    out.push({ record, inserted });
  }

  return out;
}

function coerceOptionText(text: string): OptionText | null {
  const normalized = text.trim();
  const titleCase =
    normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  const parsed = OptionTextSchema.safeParse(titleCase);
  return parsed.success ? parsed.data : null;
}
