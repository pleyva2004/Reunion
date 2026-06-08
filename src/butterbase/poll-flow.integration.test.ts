import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "../config.js";
import { ButterbaseClient } from "./api.js";
import { ButterbaseStore } from "./butterbase-store.js";
import { IntentIngressService } from "./intent-ingress.js";
import { InProcessButterbaseIngress } from "./ingress-client.js";
import { MockPollAdapter } from "../photon/imessage-adapter.mock.js";
import { InMemoryKnowledge } from "../xtrace/client.js";
import { RocketRideOrchestrator } from "../rocketride/pipeline.js";
import { PhotonConnector } from "../photon/connector.js";
import type { Classifier } from "../intent/classifier.js";
import type { PollAdapter } from "../photon/imessage-adapter.js";
import type {
  InboundMessage,
  IntentClassificationResult,
} from "../contracts/types.js";

const hasCreds = !!(
  config.butterbase.appId &&
  config.butterbase.apiKey &&
  config.butterbase.baseUrl
);

const passingClassifier: Classifier = {
  async classify(m: InboundMessage): Promise<IntentClassificationResult> {
    return {
      message_id: m.messageId,
      chat_guid: m.chatGuid,
      platform: "imessage",
      text: m.text,
      classified_at: new Date().toISOString(),
      travel_intent: { detected: true, confidence: 0.9, signal: "mixed" },
      extracted: { destination: "Tahoe", timeframe: "summer", participants_mentioned: [] },
      should_orchestrate: true,
    };
  },
};

function uniqueChat(): string {
  return `iMessage;+;it-${randomUUID()}`;
}

function inbound(messageId: string, chatGuid: string): InboundMessage {
  return { messageId, chatGuid, text: "let's plan a trip", platform: "imessage" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRoster(
  knowledge: InMemoryKnowledge,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (knowledge.records.length === 0 && Date.now() < deadline) {
    await sleep(100);
  }
}

interface CreatedRun {
  tripId: string;
  pollId: string;
  chatGuid: string;
}

function setupPhoton(
  adapter: PollAdapter,
  store: ButterbaseStore,
  knowledge: InMemoryKnowledge,
  completionTimeoutMs: number,
): PhotonConnector {
  const ingress = new InProcessButterbaseIngress(new IntentIngressService(store), store);
  const orchestrator = new RocketRideOrchestrator({
    adapter,
    store,
    knowledge,
    completionTimeoutMs,
  });
  const photon = new PhotonConnector({
    classifier: passingClassifier,
    adapter,
    ingress,
    orchestrator,
    confidenceThreshold: 0.6,
  });
  photon.start();
  return photon;
}

async function cleanupRun(client: ButterbaseClient, run: CreatedRun): Promise<void> {
  try {
    await client.deleteWhere("poll_votes", { poll_id: `eq.${run.pollId}` });
    await client.deleteWhere("trip_participants", { trip_id: `eq.${run.tripId}` });
    await client.delete("polls", run.pollId);
    await client.delete("trips", run.tripId);
    await client.delete("chat_groups", run.chatGuid);
  } catch {
    // best-effort cleanup
  }
}

describe.skipIf(!hasCreds)("poll-flow against live Butterbase", () => {
  let client: ButterbaseClient;
  let store: ButterbaseStore;
  const created: CreatedRun[] = [];

  beforeAll(async () => {
    const { appId, apiKey, baseUrl } = config.butterbase;
    client = new ButterbaseClient({ appId: appId!, apiKey: apiKey!, baseUrl: baseUrl! });
    await client.ensurePollFlowSchema();
    store = new ButterbaseStore(client);
  });

  afterAll(async () => {
    for (const run of created) {
      await cleanupRun(client, run);
    }
  });

  it(
    "Scenario A: all voted → complete roster persisted to Butterbase",
    async () => {
    const chatGuid = uniqueChat();
    const participants = ["+1", "+2", "+3"];
    const adapter = new MockPollAdapter();
    adapter.seedChat(chatGuid, {
      participants,
      contacts: { "+1": "Alice", "+2": "Bob" },
    });
    const knowledge = new InMemoryKnowledge();
    const photon = setupPhoton(adapter, store, knowledge, 60_000);

    const messageId = `msg-${randomUUID()}`;
    await photon.handleInbound(inbound(messageId, chatGuid));

    const poll = await store.findPollByChatAndKind(chatGuid, "availability");
    expect(poll).toBeDefined();
    expect(poll!.externalPollGuid).toBeTruthy();
    expect(poll!.participantSnapshot).toEqual(participants);

    const trip = await store.findTripById(poll!.tripId);
    expect(trip).toBeDefined();
    expect(trip!.chatGuid).toBe(chatGuid);

    const guid = poll!.externalPollGuid!;
    adapter.emitVote(guid, "+1", "Yes");
    adapter.emitVote(guid, "+2", "No");
    adapter.emitVote(guid, "+3", "Yes");
    await waitForRoster(knowledge);

    expect(knowledge.records).toHaveLength(1);
    const roster = knowledge.records[0]!.roster;
    expect(roster.complete).toBe(true);
    const users = [...roster.users].sort((a, b) =>
      a.phone_number.localeCompare(b.phone_number),
    );
    expect(users).toEqual([
      { name: "Alice", phone_number: "+1", availability: "yes" },
      { name: "Bob", phone_number: "+2", availability: "no" },
      { name: "+3", phone_number: "+3", availability: "yes" },
    ]);

    const pollRows = await client.list("polls", { id: `eq.${poll!.id}` });
    expect(pollRows[0]?.status).toBe("closed");
    expect(pollRows[0]?.closed_reason).toBe("all_voted");
    expect(pollRows[0]?.external_poll_guid).toBe(guid);
    expect(JSON.parse(String(pollRows[0]?.participant_snapshot ?? "[]"))).toEqual(
      participants,
    );

    const votes = await client.list("poll_votes", { poll_id: `eq.${poll!.id}` });
    expect(votes).toHaveLength(3);

    created.push({ tripId: poll!.tripId, pollId: poll!.id, chatGuid });
    photon.stop();
    },
    60_000,
  );

  it(
    "Scenario B: timeout → partial roster persisted to Butterbase",
    async () => {
    const chatGuid = uniqueChat();
    const participants = ["+1", "+2", "+3"];
    const adapter = new MockPollAdapter();
    adapter.seedChat(chatGuid, { participants });
    const knowledge = new InMemoryKnowledge();
    // Live Butterbase latency requires a longer window than the in-memory mock.
    const photon = setupPhoton(adapter, store, knowledge, 3_000);

    const messageId = `msg-${randomUUID()}`;
    await photon.handleInbound(inbound(messageId, chatGuid));

    const poll = await store.findPollByChatAndKind(chatGuid, "availability");
    expect(poll).toBeDefined();
    const guid = poll!.externalPollGuid!;
    adapter.emitVote(guid, "+1", "Yes");
    await waitForRoster(knowledge, 20_000);

    expect(knowledge.records).toHaveLength(1);
    const roster = knowledge.records[0]!.roster;
    expect(roster.complete).toBe(false);
    expect(roster.users).toHaveLength(1);
    expect(roster.users[0]?.availability).toBe("yes");

    const pollRows = await client.list("polls", { id: `eq.${poll!.id}` });
    expect(pollRows[0]?.status).toBe("closed");
    expect(pollRows[0]?.closed_reason).toBe("timeout");

    const votes = await client.list("poll_votes", { poll_id: `eq.${poll!.id}` });
    expect(votes).toHaveLength(1);

    created.push({ tripId: poll!.tripId, pollId: poll!.id, chatGuid });
    photon.stop();
    },
    60_000,
  );
});
