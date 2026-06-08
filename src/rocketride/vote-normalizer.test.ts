import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../butterbase/store.js";
import { normalizeVoteEvent } from "./vote-normalizer.js";
import type { PollVoteEvent } from "../contracts/types.js";

function voteEvent(handle: string, optionText: string): PollVoteEvent {
  return {
    event: "poll_vote",
    poll_message_guid: "ext-guid-1",
    chat_guid: "iMessage;+;chat1",
    votes: [
      {
        participant_handle: handle,
        option_identifier: `opt-${optionText}`,
        option_text: optionText,
      },
    ],
  };
}

describe("normalizeVoteEvent", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    const trip = await store.upsertTrip({
      chatGuid: "iMessage;+;chat1",
      destination: "Tahoe",
      timeframe: "summer",
    });
    const poll = await store.createPoll({
      tripId: trip.id,
      chatGuid: "iMessage;+;chat1",
      kind: "availability",
      title: "Can everyone make this trip?",
      options: ["Yes", "No"],
      triggerMessageId: "m-1",
    });
    await store.attachExternalPollGuid(poll.id, "ext-guid-1");
  });

  it("inserts first vote and ignores duplicates (first-vote-wins)", async () => {
    const first = await normalizeVoteEvent(voteEvent("+1", "Yes"), store);
    const second = await normalizeVoteEvent(voteEvent("+1", "No"), store);
    expect(first[0]?.inserted).toBe(true);
    expect(second[0]?.inserted).toBe(false);
    const votes = await store.getVotes(first[0]!.record.poll_id);
    expect(votes).toHaveLength(1);
    expect(votes[0]?.option_text).toBe("Yes");
  });

  it("normalizes case-insensitive option text to Yes/No", async () => {
    const [r] = await normalizeVoteEvent(voteEvent("+2", "yes"), store);
    expect(r?.record.option_text).toBe("Yes");
  });
});
