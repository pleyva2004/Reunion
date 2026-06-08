import { describe, it, expect } from "vitest";
import { RocketRideOrchestrator } from "./pipeline.js";
import { MockPollAdapter } from "../photon/imessage-adapter.mock.js";
import { InMemoryStore } from "../butterbase/store.js";
import { InMemoryKnowledge } from "../xtrace/client.js";
import { POLL_OPTIONS } from "../contracts/types.js";

const CHAT = "iMessage;+;chat-orchestrator";

describe("RocketRideOrchestrator", () => {
  it("emits roster when registerOpenPoll + recordVote complete the poll", async () => {
    const adapter = new MockPollAdapter();
    adapter.seedChat(CHAT, {
      participants: ["+1", "+2"],
      contacts: { "+1": "Alice" },
    });
    const store = new InMemoryStore();
    const knowledge = new InMemoryKnowledge();
    const orchestrator = new RocketRideOrchestrator({
      adapter,
      store,
      knowledge,
      completionTimeoutMs: 60_000,
    });

    const trip = await store.upsertTrip({
      chatGuid: CHAT,
      destination: "Tahoe",
      timeframe: "summer",
    });
    const poll = await store.createPoll({
      tripId: trip.id,
      chatGuid: CHAT,
      kind: "availability",
      title: "Can everyone make this trip?",
      options: POLL_OPTIONS,
      triggerMessageId: "trigger-1",
    });
    await store.setParticipantSnapshot(poll.id, ["+1", "+2"]);
    await store.attachExternalPollGuid(poll.id, "poll-guid-1");

    orchestrator.registerOpenPoll({
      pollId: poll.id,
      correlationId: "corr-1",
      tripId: trip.id,
      participantHandles: ["+1", "+2"],
    });

    await store.insertVoteIfAbsent({
      poll_id: poll.id,
      participant_handle: "+1",
      option_identifier: "opt-yes",
      option_text: "Yes",
      voted_at: new Date().toISOString(),
    });
    orchestrator.recordVote(poll.id, "+1");

    await store.insertVoteIfAbsent({
      poll_id: poll.id,
      participant_handle: "+2",
      option_identifier: "opt-no",
      option_text: "No",
      voted_at: new Date().toISOString(),
    });
    orchestrator.recordVote(poll.id, "+2");
    await new Promise((r) => setTimeout(r, 10));

    expect(knowledge.records).toHaveLength(1);
    expect(knowledge.records[0]!.roster.complete).toBe(true);
    expect(knowledge.records[0]!.roster.users).toEqual([
      { name: "Alice", phone_number: "+1", availability: "yes" },
      { name: "+2", phone_number: "+2", availability: "no" },
    ]);
  });
});
