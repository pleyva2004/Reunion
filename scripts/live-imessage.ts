/**
 * Manual live run: real iMessage poll adapter + live Butterbase persistence.
 *
 * Prerequisites:
 *   - macOS host with Messages.app and a running iMessage server
 *   - PHOTON_MODE=real
 *   - BUTTERBASE_APP_ID, BUTTERBASE_API_KEY, BUTTERBASE_BASE_URL in .env
 *   - IMESSAGE_SERVER_URL (default http://localhost:1234), optional IMESSAGE_API_KEY
 *   - Optional @photon-ai/advanced-imessage-kit (optionalDependency)
 *
 * Usage:
 *   PHOTON_MODE=real npm run live:imessage -- "iMessage;+;chat-guid-here"
 *   # or set IMESSAGE_CHAT_GUID in the environment
 *
 * Photon classifies on-device, POSTs to Butterbase, sends the poll, persists
 * votes to Butterbase; RocketRide emits the roster on completion.
 */
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { createPollAdapter } from "../src/photon/adapter-factory.js";
import { createStore } from "../src/butterbase/create-store.js";
import { IntentIngressService } from "../src/butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "../src/butterbase/ingress-client.js";
import { InMemoryKnowledge } from "../src/xtrace/client.js";
import { HeuristicClassifier } from "../src/intent/classifier.js";
import { RocketRideOrchestrator } from "../src/rocketride/pipeline.js";
import { PhotonConnector } from "../src/photon/connector.js";
import type { InboundMessage } from "../src/contracts/types.js";

const chatGuidArg = process.argv[2] ?? process.env.IMESSAGE_CHAT_GUID;
if (!chatGuidArg) {
  console.error(
    "Usage: PHOTON_MODE=real npm run live:imessage -- <chatGuid>\n" +
      "  or set IMESSAGE_CHAT_GUID in the environment",
  );
  process.exit(1);
}

if (config.photonMode !== "real") {
  console.error("Set PHOTON_MODE=real to use the real iMessage adapter.");
  process.exit(1);
}

const chatGuid = chatGuidArg;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const adapter = createPollAdapter();
  const store = await createStore();
  const knowledge = new InMemoryKnowledge();
  const ingress = new InProcessButterbaseIngress(new IntentIngressService(store), store);
  const orchestrator = new RocketRideOrchestrator({
    adapter,
    store,
    knowledge,
    completionTimeoutMs: config.completionTimeoutMs,
  });
  const photon = new PhotonConnector({
    classifier: new HeuristicClassifier(),
    adapter,
    ingress,
    orchestrator,
    confidenceThreshold: config.intentConfidenceThreshold,
  });

  if (adapter.connect) await adapter.connect();
  photon.start();

  const message: InboundMessage = {
    messageId: `live-${randomUUID()}`,
    chatGuid,
    text: "Let's plan a trip to Lake Tahoe this summer!",
    platform: "imessage",
  };

  console.log(`\nClassifying and sending availability poll to ${chatGuid} …`);
  await photon.handleInbound(message);

  const poll = await store.findPollByChatAndKind(chatGuid, "availability");
  if (!poll?.externalPollGuid) {
    throw new Error("poll was not created — check intent gate / Butterbase logs");
  }
  console.log(`Poll created (external guid: ${poll.externalPollGuid}). Waiting for votes …`);
  console.log(
    `Completion timeout: ${config.completionTimeoutMs}ms (${Math.round(config.completionTimeoutMs / 3_600_000)}h if default)`,
  );

  const deadline = Date.now() + config.completionTimeoutMs + 5_000;
  while (knowledge.records.length === 0 && Date.now() < deadline) {
    await sleep(500);
  }

  if (knowledge.records.length === 0) {
    console.log("\nNo roster emitted yet — timeout may not have fired. Stopping.");
  } else {
    console.log("\n=== Roster ===");
    console.log(JSON.stringify(knowledge.records[knowledge.records.length - 1]?.roster, null, 2));
  }

  photon.stop();
  if (adapter.close) await adapter.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
