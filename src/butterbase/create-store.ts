import { config } from "../config.js";
import { logger } from "../observability/logger.js";
import { ButterbaseClient } from "./api.js";
import { ButterbaseStore } from "./butterbase-store.js";
import { InMemoryStore, type Store } from "./store.js";

/**
 * Returns Butterbase-backed state when credentials are configured;
 * falls back to in-memory for local dev and tests.
 */
export async function createStore(): Promise<Store> {
  const { appId, apiKey, baseUrl } = config.butterbase;
  if (!appId || !apiKey || !baseUrl) {
    logger.info("Butterbase credentials missing — using in-memory store");
    return new InMemoryStore();
  }

  const client = new ButterbaseClient({ appId, apiKey, baseUrl });
  await client.ensurePollFlowSchema();
  const realtime = await client.ensureIntentEventsRealtime();
  logger.info(
    { appId, intentEventsRealtime: realtime.enabled, tables: realtime.tables },
    "Butterbase poll-flow schema ready",
  );
  return new ButterbaseStore(client);
}
