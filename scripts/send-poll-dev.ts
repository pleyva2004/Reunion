/**
 * Send an availability poll to the Dev group chat.
 *
 * Resolves the Dev chat guid from DEV_CHAT_GUID or by name via imessage-kit,
 * then runs the full Photon → Butterbase → poll send path.
 *
 * Prerequisites:
 *   - PHOTON_MODE=real
 *   - A poll-capable iMessage backend (see npm run setup:photon)
 *   - Butterbase credentials in .env
 *
 * Usage:
 *   npm run send-poll:dev
 */
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { createPollAdapter } from "../src/photon/adapter-factory.js";
import { resolveGroupChatGuidByName } from "../src/photon/imessage-local-db.js";
import {
  pollSendBlockedMessage,
  probeImessageServer,
} from "../src/photon/imessage-server-probe.js";
import { createStore } from "../src/butterbase/create-store.js";
import { IntentIngressService } from "../src/butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "../src/butterbase/ingress-client.js";
import { InMemoryKnowledge } from "../src/xtrace/client.js";
import { HeuristicClassifier } from "../src/intent/classifier.js";
import { RocketRideOrchestrator } from "../src/rocketride/pipeline.js";
import { PhotonConnector } from "../src/photon/connector.js";
import type { InboundMessage } from "../src/contracts/types.js";

const DEV_CHAT_NAME = "Dev";

async function resolveDevChatGuid(): Promise<string> {
  if (config.imessage.devChatGuid) {
    return config.imessage.devChatGuid;
  }

  const fromDb = await resolveGroupChatGuidByName(DEV_CHAT_NAME);
  if (!fromDb) {
    throw new Error(
      `Could not find a group chat named "${DEV_CHAT_NAME}".\n` +
        "  Run `npm run list:chats -- --groups-only` and set DEV_CHAT_GUID in .env",
    );
  }
  return fromDb;
}

async function assertPollBackendReady(): Promise<void> {
  if (
    (config.imessage.grpcAddress && config.imessage.grpcToken) ||
    (config.spectrum.projectId && config.spectrum.projectSecret)
  ) {
    console.log(
      `Using Spectrum cloud gRPC at ${config.imessage.grpcAddress ?? "imessage.spectrum.photon.codes:443"}`,
    );
    return;
  }

  const reachable = await probeImessageServer(config.imessage.serverUrl);
  if (!reachable) {
    throw new Error(pollSendBlockedMessage(config.imessage.serverUrl));
  }
}

async function main(): Promise<void> {
  if (config.photonMode !== "real") {
    console.error("Set PHOTON_MODE=real in .env");
    process.exit(1);
  }

  await assertPollBackendReady();
  const chatGuid = await resolveDevChatGuid();
  console.log(`Dev group chat: ${chatGuid}`);

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
    messageId: `dev-poll-${randomUUID()}`,
    chatGuid,
    text: "Let's plan a trip to Lake Tahoe this summer!",
    platform: "imessage",
  };

  console.log("\nClassifying and sending availability poll to Dev …");
  await photon.handleInbound(message);

  const poll = await store.findPollByChatAndKind(chatGuid, "availability");
  if (!poll?.externalPollGuid) {
    throw new Error("Poll was not created — check intent gate / Butterbase logs");
  }

  console.log(`\nPoll sent to Dev (external guid: ${poll.externalPollGuid})`);
  console.log("Check the Dev group chat in Messages.app.");

  photon.stop();
  if (adapter.close) await adapter.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
