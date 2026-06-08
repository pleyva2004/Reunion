import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { HeuristicClassifier } from "./intent/classifier.js";
import { MockPollAdapter } from "./photon/imessage-adapter.mock.js";
import { registerSpectrumWebhook } from "./photon/spectrum-webhook.js";
import { MockButterbaseClient } from "./butterbase/mock-client.js";
import { ButterbaseStore } from "./butterbase/butterbase-store.js";
import { IntentIngressService } from "./butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "./butterbase/ingress-client.js";
import { registerButterbaseRoutes } from "./butterbase/routes.js";
import { InMemoryKnowledge } from "./xtrace/client.js";
import { RocketRideOrchestrator } from "./rocketride/pipeline.js";
import { PhotonConnector } from "./photon/connector.js";

const CHAT = "iMessage;+;chat-tahoe";
const PARTICIPANTS = ["+14155551234", "+14155559876", "+14155550000"];

function spectrumPayload(messageId: string, chatGuid: string, text: string) {
  return {
    event: "messages",
    message: {
      id: messageId,
      content: { type: "text", text },
    },
    space: { id: chatGuid },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface TestHarness {
  app: ReturnType<typeof Fastify>;
  adapter: MockPollAdapter;
  butterbase: MockButterbaseClient;
  store: ButterbaseStore;
  knowledge: InMemoryKnowledge;
  photon: PhotonConnector;
  flush: () => Promise<unknown[]>;
}

async function buildHarness(completionTimeoutMs = 50): Promise<TestHarness> {
  const adapter = new MockPollAdapter();
  adapter.seedChat(CHAT, {
    participants: PARTICIPANTS,
    contacts: {
      "+14155551234": "Alice Chen",
      "+14155559876": "Bob Martinez",
    },
  });

  const butterbase = new MockButterbaseClient();
  await butterbase.ensurePollFlowSchema();
  const store = new ButterbaseStore(butterbase);
  const knowledge = new InMemoryKnowledge();
  const ingress = new InProcessButterbaseIngress(new IntentIngressService(store), store);
  const orchestrator = new RocketRideOrchestrator({
    adapter,
    store,
    knowledge,
    completionTimeoutMs,
  });
  const photon = new PhotonConnector({
    classifier: new HeuristicClassifier(),
    adapter,
    ingress,
    orchestrator,
    confidenceThreshold: 0.6,
  });
  photon.start();

  const pending: Promise<unknown>[] = [];
  const app = Fastify({ logger: false });
  registerButterbaseRoutes(app, ingress);
  registerSpectrumWebhook(app, {
    onInbound: (message) => {
      const p = photon.handleInbound(message);
      pending.push(p);
      return p;
    },
  });
  await app.ready();

  return {
    app,
    adapter,
    butterbase,
    store,
    knowledge,
    photon,
    flush: () => Promise.all(pending),
  };
}

async function postSpectrum(
  app: TestHarness["app"],
  messageId: string,
  chatGuid: string,
  text: string,
) {
  const body = JSON.stringify(spectrumPayload(messageId, chatGuid, text));
  return app.inject({
    method: "POST",
    url: "/spectrum-webhook",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

describe("intent → poll → roster flow (integration)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    harness.photon.stop();
    await harness.app.close();
  });

  it("runs the full happy path: Photon → Butterbase → poll → all votes → roster", async () => {
    const res = await postSpectrum(
      harness.app,
      "msg-1",
      CHAT,
      "Let's plan a trip to Lake Tahoe in July with the crew!",
    );
    expect(res.statusCode).toBe(200);
    await harness.flush();

    const tripRows = harness.butterbase.snapshot("trips");
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0]?.chat_guid).toBe(CHAT);
    expect(tripRows[0]?.destination).toBe("Lake Tahoe");
    expect(tripRows[0]?.timeframe).toBe("in july");

    const poll = await harness.store.findPollByChatAndKind(CHAT, "availability");
    expect(poll).toBeDefined();
    expect(poll!.options).toEqual(["Yes", "No"]);
    expect(poll!.externalPollGuid).toBeTruthy();
    expect(poll!.participantSnapshot).toEqual(PARTICIPANTS);

    const pollRows = harness.butterbase.snapshot("polls");
    expect(pollRows[0]?.status).toBe("open");

    const guid = poll!.externalPollGuid!;
    const vote = async (handle: string, option: "Yes" | "No") => {
      harness.adapter.emitVote(guid, handle, option);
      await harness.flush();
    };
    await vote("+14155551234", "Yes");
    await vote("+14155559876", "No");
    await vote("+14155551234", "No");
    await vote("+14155550000", "Yes");
    await sleep(10);

    expect(harness.knowledge.records).toHaveLength(1);
    const { roster, context } = harness.knowledge.records[0]!;
    expect(roster.complete).toBe(true);
    expect(roster.users).toEqual([
      { name: "Alice Chen", phone_number: "+14155551234", availability: "yes" },
      { name: "Bob Martinez", phone_number: "+14155559876", availability: "no" },
      { name: "+14155550000", phone_number: "+14155550000", availability: "yes" },
    ]);
    expect(context.destination).toBe("Lake Tahoe");
    expect(context.timeframe).toBe("in july");
    expect(context.participants).toEqual(PARTICIPANTS);

    const closedPoll = harness.butterbase.snapshot("polls")[0];
    expect(closedPoll?.status).toBe("closed");
    expect(closedPoll?.closed_reason).toBe("all_voted");

    const votes = harness.butterbase.snapshot("poll_votes");
    expect(votes).toHaveLength(3);
    expect(votes.filter((v) => v.participant_handle === "+14155551234")).toHaveLength(1);
    expect(votes.find((v) => v.participant_handle === "+14155551234")?.option_text).toBe(
      "Yes",
    );
  });

  it("closes on 24h timeout with a partial roster when not everyone votes", async () => {
    harness.photon.stop();
    await harness.app.close();
    harness = await buildHarness(40);

    await postSpectrum(
      harness.app,
      "msg-partial",
      CHAT,
      "We should book flights to New York for Labor Day weekend",
    );
    await harness.flush();

    const poll = await harness.store.findPollByChatAndKind(CHAT, "availability");
    const guid = poll!.externalPollGuid!;
    harness.adapter.emitVote(guid, "+14155551234", "Yes");
    await harness.flush();
    await sleep(60);

    expect(harness.knowledge.records).toHaveLength(1);
    const roster = harness.knowledge.records[0]!.roster;
    expect(roster.complete).toBe(false);
    expect(roster.users).toHaveLength(1);
    expect(roster.users[0]?.availability).toBe("yes");

    const closedPoll = harness.butterbase.snapshot("polls")[0];
    expect(closedPoll?.status).toBe("closed");
    expect(closedPoll?.closed_reason).toBe("timeout");
  });

  it("does not start a poll when intent gate fails (casual chatter)", async () => {
    const res = await postSpectrum(
      harness.app,
      "msg-chatter",
      CHAT,
      "lol that meme is hilarious",
    );
    expect(res.statusCode).toBe(200);
    await harness.flush();

    expect(harness.butterbase.snapshot("trips")).toHaveLength(0);
    expect(harness.butterbase.snapshot("polls")).toHaveLength(0);
    expect(harness.knowledge.records).toHaveLength(0);
  });

  it("deduplicates poll creation for the same chat", async () => {
    await postSpectrum(harness.app, "msg-a", CHAT, "Let's plan a trip to Tahoe in August");
    await harness.flush();
    const firstGuid = (await harness.store.findPollByChatAndKind(CHAT, "availability"))
      ?.externalPollGuid;

    await postSpectrum(harness.app, "msg-b", CHAT, "Another trip plan to Tahoe in September");
    await harness.flush();
    const secondGuid = (await harness.store.findPollByChatAndKind(CHAT, "availability"))
      ?.externalPollGuid;

    expect(harness.butterbase.snapshot("polls")).toHaveLength(1);
    expect(secondGuid).toBe(firstGuid);
  });

  it("verifies signed Spectrum webhooks when a signing secret is configured", async () => {
    harness.photon.stop();
    await harness.app.close();

    const secret = "test-signing-secret";
    const adapter = new MockPollAdapter();
    adapter.seedChat(CHAT, { participants: PARTICIPANTS });
    const butterbase = new MockButterbaseClient();
    await butterbase.ensurePollFlowSchema();
    const store = new ButterbaseStore(butterbase);
    const knowledge = new InMemoryKnowledge();
    const ingress = new InProcessButterbaseIngress(new IntentIngressService(store), store);
    const orchestrator = new RocketRideOrchestrator({
      adapter,
      store,
      knowledge,
      completionTimeoutMs: 50,
    });
    const photon = new PhotonConnector({
      classifier: new HeuristicClassifier(),
      adapter,
      ingress,
      orchestrator,
      confidenceThreshold: 0.6,
    });
    photon.start();

    const pending: Promise<unknown>[] = [];
    const app = Fastify({ logger: false });
    registerSpectrumWebhook(app, {
      signingSecret: secret,
      onInbound: (m) => {
        const p = photon.handleInbound(m);
        pending.push(p);
        return p;
      },
    });
    await app.ready();

    const body = JSON.stringify(
      spectrumPayload("msg-signed", CHAT, "Let's plan a trip to Tahoe in July"),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v0=" +
      createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");

    const bad = await app.inject({
      method: "POST",
      url: "/spectrum-webhook",
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({
      method: "POST",
      url: "/spectrum-webhook",
      headers: {
        "content-type": "application/json",
        "x-spectrum-timestamp": timestamp,
        "x-spectrum-signature": signature,
      },
      payload: body,
    });
    expect(ok.statusCode).toBe(200);
    await Promise.all(pending);
    expect(await store.findPollByChatAndKind(CHAT, "availability")).toBeDefined();

    photon.stop();
    await app.close();
  });
});
