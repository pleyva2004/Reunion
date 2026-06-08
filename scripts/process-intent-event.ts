/**
 * One-shot: process an intent_events row and send the availability poll.
 *
 * Usage:
 *   npx tsx scripts/process-intent-event.ts
 *   npx tsx scripts/process-intent-event.ts <message_id>
 */
import { config } from "../src/config.js";
import { ButterbaseClient } from "../src/butterbase/api.js";
import { createStore } from "../src/butterbase/create-store.js";
import { IntentIngressService } from "../src/butterbase/intent-ingress.js";
import { InProcessButterbaseIngress } from "../src/butterbase/ingress-client.js";
import { createPollAdapter } from "../src/photon/adapter-factory.js";
import { InMemoryKnowledge } from "../src/xtrace/client.js";
import { RocketRideOrchestrator } from "../src/rocketride/pipeline.js";
import { IntentEventProcessor } from "../src/rocketride/intent-event-processor.js";
import { IntentEventSchema } from "../src/contracts/types.js";

const DEFAULT_MESSAGE_ID = "DCDBCA84-FB81-4227-B99A-A1529937D489";

async function main(): Promise<void> {
  const targetMessageId = process.argv[2] ?? DEFAULT_MESSAGE_ID;
  const { appId, apiKey, baseUrl } = config.butterbase;
  if (!appId || !apiKey || !baseUrl) throw new Error("Butterbase credentials missing");

  const client = new ButterbaseClient({ appId, apiKey, baseUrl });
  const rows = await client.listIntentEvents({ message_id: `eq.${targetMessageId}` });
  if (!rows.length) throw new Error(`intent_events row not found: ${targetMessageId}`);
  const event = IntentEventSchema.parse(rows[0]);
  console.log(`Intent event: "${event.text}" → ${event.location}`);

  const { resolveChatGuid } = await import("../src/photon/chat-resolver.js");
  const chatGuid = await resolveChatGuid({
    chatId: event.chat_id,
    chatName: event.chat_name ?? null,
    chatKind: event.chat_kind ?? null,
  });
  if (!chatGuid) throw new Error(`Could not resolve chat for ${event.chat_name ?? event.chat_id}`);

  const blocking = await client.list("polls", {
    chat_guid: `eq.${chatGuid}`,
    kind: "eq.availability",
    status: "eq.open",
  });
  for (const row of blocking) {
    if (!row.external_poll_guid) {
      console.log(`Removing unsent blocking poll ${row.id}`);
      try {
        await client.deleteWhere("poll_votes", { poll_id: `eq.${row.id}` });
      } catch {
        // no votes yet
      }
      await client.delete("polls", String(row.id));
      if (row.trip_id) await client.delete("trips", String(row.trip_id));
    }
  }

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
  const processor = new IntentEventProcessor({
    adapter,
    ingress,
    orchestrator,
    confidenceThreshold: config.intentConfidenceThreshold,
  });

  if (adapter.connect) await adapter.connect();
  await processor.process(event);

  const poll = await store.findPollByTriggerMessageId(targetMessageId);
  if (!poll?.externalPollGuid) {
    const existing = await store.findPollByChatAndKind(chatGuid, "availability");
    throw new Error(
      `Poll not sent. trigger=${JSON.stringify(poll)} existing=${JSON.stringify(existing)}`,
    );
  }

  console.log("\nPoll sent");
  console.log(`  chat: ${event.chat_name ?? event.chat_id}`);
  console.log(`  poll_id: ${poll.id}`);
  console.log(`  external_poll_guid: ${poll.externalPollGuid}`);
  console.log(`  destination: ${event.location}`);

  orchestrator.stop();
  if (adapter.close) await adapter.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
