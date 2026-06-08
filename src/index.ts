import Fastify from "fastify";
import { config } from "./config.js";
import { logger } from "./observability/logger.js";
import { HeuristicClassifier } from "./intent/classifier.js";
import { createPollAdapter } from "./photon/adapter-factory.js";
import { createStore } from "./butterbase/create-store.js";
import { IntentIngressService } from "./butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "./butterbase/ingress-client.js";
import { registerButterbaseRoutes } from "./butterbase/routes.js";
import { InMemoryKnowledge } from "./xtrace/client.js";
import { RocketRideOrchestrator } from "./rocketride/pipeline.js";
import { PhotonConnector } from "./photon/connector.js";
import { registerSpectrumWebhook } from "./photon/spectrum-webhook.js";
import { startSpectrumInbound, type InboundHandle } from "./photon/spectrum-listener.js";
import { IntentEventProcessor } from "./rocketride/intent-event-processor.js";
import { IntentEventListener } from "./rocketride/intent-event-listener.js";

/**
 * Monolithic dev server wiring the contract boundaries:
 *   XTrace → intent_events (Butterbase realtime) → RocketRide → Photon poll send
 *   RocketRide (completion + roster → XTrace)
 */
async function main(): Promise<void> {
  const adapter = createPollAdapter();
  const store = await createStore();
  const knowledge = new InMemoryKnowledge();
  const classifier = new HeuristicClassifier();

  const intentIngress = new IntentIngressService(store);
  const butterbaseIngress = new InProcessButterbaseIngress(intentIngress, store);

  const orchestrator = new RocketRideOrchestrator({
    adapter,
    store,
    knowledge,
    completionTimeoutMs: config.completionTimeoutMs,
  });

  const photon = new PhotonConnector({
    classifier,
    adapter,
    ingress: butterbaseIngress,
    orchestrator,
    confidenceThreshold: config.intentConfidenceThreshold,
  });

  if (adapter.connect) {
    try {
      await adapter.connect();
    } catch (err) {
      logger.warn(
        { err, serverUrl: config.imessage.serverUrl },
        "iMessage poll server unavailable — inbound still works; polls need IMESSAGE_SERVER_URL",
      );
    }
  }
  photon.start();

  let intentListener: IntentEventListener | null = null;
  const { appId, apiKey, baseUrl } = config.butterbase;
  if (appId && apiKey && baseUrl) {
    const intentProcessor = new IntentEventProcessor({
      adapter,
      ingress: butterbaseIngress,
      orchestrator,
      confidenceThreshold: config.intentConfidenceThreshold,
    });
    intentListener = new IntentEventListener({
      butterbase: { appId, apiKey, baseUrl },
      processor: intentProcessor,
    });
    try {
      await intentListener.start();
      logger.info("intent_events realtime listener started (canonical trigger)");
    } catch (err) {
      logger.warn({ err }, "intent_events listener failed to start");
      intentListener = null;
    }
  }

  let inboundHandle: InboundHandle | null = null;
  if (config.inboundMode === "spectrum-local" || config.inboundMode === "spectrum-cloud") {
    try {
      inboundHandle = await startSpectrumInbound(
        config.inboundMode,
        (message) => photon.handleInbound(message),
        {
          projectId: config.spectrum.projectId,
          projectSecret: config.spectrum.projectSecret,
        },
      );
    } catch (err) {
      logger.error(
        { err, inboundMode: config.inboundMode },
        "inbound listener failed — grant Full Disk Access to Terminal/Cursor for local mode",
      );
    }
  }

  const app = Fastify({ logger: false });

  registerButterbaseRoutes(app, butterbaseIngress);
  registerSpectrumWebhook(app, {
    signingSecret: config.spectrum.signingSecret,
    onInbound: (message) => photon.handleInbound(message),
  });

  app.get("/health", async () => ({
    status: "ok",
    photonMode: config.photonMode,
    inboundMode: config.inboundMode,
  }));

  const closeAll = async () => {
    intentListener?.stop();
    if (inboundHandle) await inboundHandle.stop();
    photon.stop();
    orchestrator.stop();
    if (adapter.close) await adapter.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void closeAll());
  process.on("SIGTERM", () => void closeAll());

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info(
    {
      port: config.port,
      photonMode: config.photonMode,
      inboundMode: config.inboundMode,
    },
    "Reunion intent-to-poll service listening",
  );
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
