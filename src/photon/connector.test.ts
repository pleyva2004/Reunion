import { describe, it, expect, beforeEach } from "vitest";
import { PhotonConnector } from "./connector.js";
import { MockPollAdapter } from "./imessage-adapter.mock.js";
import { InMemoryStore } from "../butterbase/store.js";
import { IntentIngressService } from "../butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "../butterbase/ingress-client.js";
import { RocketRideOrchestrator } from "../rocketride/pipeline.js";
import { InMemoryKnowledge } from "../xtrace/client.js";
import type { Classifier } from "../intent/classifier.js";
import type { PollAdapter } from "./imessage-adapter.js";
import type {
  InboundMessage,
  IntentClassificationResult,
} from "../contracts/types.js";

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

const CHAT = "iMessage;+;chat1";

function buildConnector(adapter: PollAdapter, completionTimeoutMs = 60_000) {
  const store = new InMemoryStore();
  const knowledge = new InMemoryKnowledge();
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
  return { store, knowledge, photon, orchestrator };
}

function inbound(id: string, text = "let's plan a trip"): InboundMessage {
  return { messageId: id, chatGuid: CHAT, text, platform: "imessage" };
}

describe("PhotonConnector idempotency", () => {
  let adapter: MockPollAdapter;

  beforeEach(() => {
    adapter = new MockPollAdapter();
    adapter.seedChat(CHAT, { participants: ["+1", "+2"] });
  });

  it("does not create a duplicate poll for the same trigger_message_id", async () => {
    const { store, photon } = buildConnector(adapter);
    await photon.handleInbound(inbound("m-1"));
    await photon.handleInbound(inbound("m-1"));
    expect(await store.findPollByChatAndKind(CHAT, "availability")).toBeDefined();
    const poll = (await store.findPollByChatAndKind(CHAT, "availability"))!;
    expect(poll.triggerMessageId).toBe("m-1");
  });

  it("dedups on (chat_guid, kind) before a trip exists", async () => {
    const { store, photon } = buildConnector(adapter);
    await photon.handleInbound(inbound("m-1"));
    const firstGuid = (await store.findPollByChatAndKind(CHAT, "availability"))
      ?.externalPollGuid;
    await photon.handleInbound(inbound("m-2"));
    const secondGuid = (await store.findPollByChatAndKind(CHAT, "availability"))
      ?.externalPollGuid;
    expect(secondGuid).toBe(firstGuid);
  });
});

describe("PhotonConnector end-to-end", () => {
  it("emits a complete roster to XTrace once everyone votes", async () => {
    const adapter = new MockPollAdapter();
    adapter.seedChat(CHAT, {
      participants: ["+1", "+2"],
      contacts: { "+1": "Alice" },
    });
    const { store, knowledge, photon } = buildConnector(adapter);

    await photon.handleInbound(inbound("m-1"));
    const guid = (await store.findPollByChatAndKind(CHAT, "availability"))!
      .externalPollGuid!;
    adapter.emitVote(guid, "+1", "Yes");
    adapter.emitVote(guid, "+2", "No");
    await new Promise((r) => setTimeout(r, 10));

    expect(knowledge.records).toHaveLength(1);
    const roster = knowledge.records[0]!.roster;
    expect(roster.complete).toBe(true);
    expect(roster.users).toEqual([
      { name: "Alice", phone_number: "+1", availability: "yes" },
      { name: "+2", phone_number: "+2", availability: "no" },
    ]);
  });

  it("emits a partial roster after the timeout when not everyone voted", async () => {
    const timeoutChat = "iMessage;+;chat-timeout";
    const adapter = new MockPollAdapter();
    adapter.seedChat(timeoutChat, { participants: ["+1", "+2", "+3"] });
    const { store, knowledge, photon } = buildConnector(adapter, 30);

    await photon.handleInbound({
      messageId: "m-partial",
      chatGuid: timeoutChat,
      text: "let's plan a trip",
      platform: "imessage",
    });
    const g = (await store.findPollByChatAndKind(timeoutChat, "availability"))!
      .externalPollGuid!;
    adapter.emitVote(g, "+1", "Yes");
    await new Promise((r) => setTimeout(r, 50));

    expect(knowledge.records).toHaveLength(1);
    expect(knowledge.records[0]!.roster.complete).toBe(false);
    expect(knowledge.records[0]!.roster.users).toHaveLength(1);
  });
});

describe("PhotonConnector POLL_SEND_FAILED", () => {
  it("retries then surfaces failure without persisting an external guid", async () => {
    let attempts = 0;
    const failingAdapter: PollAdapter = {
      async createPoll() {
        attempts += 1;
        throw new Error("send failed");
      },
      async getParticipants() {
        return [{ handle: "+1" }];
      },
      async getContactNameMap() {
        return new Map();
      },
      onVote() {
        return () => {};
      },
    };
    const { store, photon } = buildConnector(failingAdapter);
    await photon.handleInbound(inbound("m-1"));
    expect(attempts).toBe(3);
    const poll = await store.findPollByChatAndKind(CHAT, "availability");
    expect(poll?.externalPollGuid).toBeNull();
  });
});
