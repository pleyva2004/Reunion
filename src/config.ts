/**
 * Central config + tool client wiring. The scaffold runs entirely on in-memory
 * stubs (USE_STUBS=true). Each owner flips their layer to the real SDK here as it
 * lands, without touching the pipeline.
 */
import { InMemoryXTrace, type MemoryStore } from "./memory/xtrace.js";
import { xtraceFromEnv } from "./memory/xtraceMemory.js";
import { InMemoryButterbase, type StateStore } from "./state/butterbase.js";
import { ButterbaseStore } from "./state/butterbaseStore.js";
import { butterbaseFromEnv } from "./state/butterbaseClient.js";

export interface Clients {
  memory: MemoryStore; // XTrace
  state: StateStore; // Butterbase
}

export function createClients(): Clients {
  const real = process.env.USE_STUBS === "false";
  // State: real Butterbase when configured; else in-memory.
  const bb = real ? butterbaseFromEnv() : null;
  const state: StateStore = bb ? new ButterbaseStore(bb) : new InMemoryButterbase();
  // Memory: real XTrace when configured (key + orgId); else in-memory belief store.
  const xt = real ? xtraceFromEnv() : null;
  const memory: MemoryStore = xt ?? new InMemoryXTrace();
  return { memory, state };
}

// RocketRide pipeline connection, read from env. Present only when at least a URI
// or API key is configured — otherwise the pipeline runs on the heuristic stub.
const rocketrideAuth = process.env.ROCKETRIDE_APIKEY ?? process.env.ROCKETRIDE_AUTH;
const rocketride =
  process.env.ROCKETRIDE_URI || rocketrideAuth
    ? {
        uri: process.env.ROCKETRIDE_URI,
        auth: rocketrideAuth,
        pipelinePath: process.env.ROCKETRIDE_PIPELINE ?? "./pipelines/extract-trip-signal.pipe",
      }
    : undefined;

// RocketRide itinerary pipeline — separate from extraction; same engine connection.
const itinerary =
  process.env.ROCKETRIDE_URI || rocketrideAuth
    ? {
        uri: process.env.ROCKETRIDE_URI,
        auth: rocketrideAuth,
        pipelinePath: process.env.ROCKETRIDE_ITINERARY_PIPELINE ?? "./pipelines/generate-itinerary.pipe",
      }
    : undefined;

// Kevin's calendar availability endpoint. Present only when both base URL and the
// shared internal key are configured; else availability runs on the in-process stub.
const calendar =
  process.env.CALENDAR_BASE_URL && process.env.CALENDAR_INTERNAL_KEY
    ? {
        baseUrl: process.env.CALENDAR_BASE_URL,
        internalKey: process.env.CALENDAR_INTERNAL_KEY,
      }
    : undefined;

// Neo4J culture graph (Aura). Present only when fully configured; else the demo
// uses the in-memory culture stub (same seed data) so it always runs.
const neo4j =
  process.env.ROCKETRIDE_NEO4J_URI && process.env.ROCKETRIDE_NEO4J_PASSWORD
    ? {
        uri: process.env.ROCKETRIDE_NEO4J_URI,
        user: process.env.ROCKETRIDE_NEO4J_USER ?? "neo4j",
        password: process.env.ROCKETRIDE_NEO4J_PASSWORD,
      }
    : undefined;

export const config = {
  useStubs: process.env.USE_STUBS !== "false",
  // Demo speed knob: run extraction on the instant local heuristic even when the
  // other tools are live. A live extract is ~11s and runs per message (~44s floor),
  // so this keeps the all-live demo under a minute while RocketRide stays visible on
  // the itinerary. Independent of USE_STUBS so state/memory/itinerary stay live.
  fastExtract: process.env.FAST_EXTRACT === "true",
  channel: (process.env.CHANNEL ?? "iMessage") as "iMessage" | "telegram",
  rocketride,
  itinerary,
  calendar,
  neo4j,
};
