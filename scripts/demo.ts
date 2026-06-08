import { MockPollAdapter } from "../src/photon/imessage-adapter.mock.js";
import { InMemoryStore } from "../src/butterbase/store.js";
import { IntentIngressService } from "../src/butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "../src/butterbase/ingress-client.js";
import { InMemoryKnowledge } from "../src/xtrace/client.js";
import { HeuristicClassifier } from "../src/intent/classifier.js";
import { RocketRideOrchestrator } from "../src/rocketride/pipeline.js";
import { PhotonConnector } from "../src/photon/connector.js";
import type { InboundMessage } from "../src/contracts/types.js";

const PLATFORM = "imessage" as const;

function msg(id: string, chatGuid: string, text: string): InboundMessage {
  return { messageId: id, chatGuid, text, platform: PLATFORM };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildPhoton(
  adapter: MockPollAdapter,
  store: InMemoryStore,
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
    classifier: new HeuristicClassifier(),
    adapter,
    ingress,
    orchestrator,
    confidenceThreshold: 0.6,
  });
  photon.start();
  return photon;
}

async function main(): Promise<void> {
  const adapter = new MockPollAdapter();
  const store = new InMemoryStore();
  const knowledge = new InMemoryKnowledge();
  const photon = buildPhoton(adapter, store, knowledge, 60_000);

  const tahoe = "iMessage;+;chat-tahoe";
  adapter.seedChat(tahoe, {
    participants: ["+14155551234", "+14155559876", "+14155550000", "+14155551111"],
    contacts: {
      "+14155551234": "Alice Chen",
      "+14155559876": "Bob Martinez",
      "+14155550000": "Carol Diaz",
    },
  });

  console.log("\n=== Scenario A: travel intent -> Butterbase -> poll -> full roster ===");
  await photon.handleInbound(
    msg("m-1", tahoe, "Let's plan a trip to Lake Tahoe this summer with Bob and Carol!"),
  );

  const pollGuid = (await store.findPollByChatAndKind(tahoe, "availability"))
    ?.externalPollGuid;
  if (!pollGuid) throw new Error("expected a poll to be created");

  adapter.emitVote(pollGuid, "+14155551234", "Yes");
  adapter.emitVote(pollGuid, "+14155559876", "No");
  adapter.emitVote(pollGuid, "+14155551234", "No");
  adapter.emitVote(pollGuid, "+14155550000", "No");
  adapter.emitVote(pollGuid, "+14155551111", "Yes");
  await sleep(10);

  console.log("\n=== Scenario B: casual chatter -> gate fails (NoOp) ===");
  await photon.handleInbound(
    msg("m-2", "iMessage;+;chat-random", "lol that meme is hilarious"),
  );

  const nyc = "iMessage;+;chat-nyc";
  adapter.seedChat(nyc, {
    participants: ["+12125550001", "+12125550002", "+12125550003"],
    contacts: { "+12125550001": "Dana Lee", "+12125550002": "Evan Wu" },
  });

  console.log("\n=== Scenario C: partial roster after timeout ===");
  const nycStore = new InMemoryStore();
  const partialKnowledge = new InMemoryKnowledge();
  const timeoutPhoton = buildPhoton(adapter, nycStore, partialKnowledge, 50);
  await timeoutPhoton.handleInbound(
    msg("m-3", nyc, "We should book flights to New York for Labor Day weekend"),
  );
  const nycGuid = (await nycStore.findPollByChatAndKind(nyc, "availability"))
    ?.externalPollGuid;
  if (!nycGuid) throw new Error("expected NYC poll");
  adapter.emitVote(nycGuid, "+12125550001", "Yes");
  await sleep(80);
  console.log(JSON.stringify(partialKnowledge.records[0]?.roster, null, 2));
  timeoutPhoton.stop();

  console.log("\n=== XTrace knowledge written (Scenario A) ===");
  console.log(JSON.stringify(knowledge.records.map((r) => r.roster), null, 2));

  photon.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
