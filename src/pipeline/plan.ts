/**
 * RocketRide step: memory-aware planning.  [Owner: Jossue]
 *
 * The orchestration core of the "what". Given an actionable destination-known
 * signal, it: persists trip state, resolves availability (Kevin's calendar endpoint
 * or the in-process stub, injected), auto-picks the best window, and renders an
 * itinerary from the destination + window + durable group facts (XTrace) + culture
 * brief. Returns a PlanResult that nextAction posts back into chat.
 *
 * `availability` and `generateItinerary` are injected so this is unit-testable and
 * the real SDKs are swappable without touching the pipeline.
 */
import type { Clients } from "../config.js";
import type {
  CandidateWeekend,
  GroupBrief,
  PendingConnect,
  Trip,
  TripSignal,
} from "../contracts/index.js";
import type { RouteDecision } from "./route.js";
import { upsertTripFromSignal } from "../planning/what/tripState.js";
import { buildSummary } from "../planning/what/summary.js";
import {
  renderItineraryTemplate,
  type ItineraryFacts,
  type ItineraryGenerator,
} from "../planning/what/itinerary.js";
import type { AvailabilityResolver } from "../planning/when/availabilityResolver.js";

export type NextStep = "itinerary" | "gather-availability" | "summary";

export interface PlanResult {
  trip: Trip;
  signal: TripSignal;
  summary: string;
  candidates: CandidateWeekend[];
  chosenWindow?: CandidateWeekend;
  itinerary?: string;
  pendingConnects: PendingConnect[];
  nextStep: NextStep;
  cultureBrief?: GroupBrief | null;
}

export interface PlanDeps {
  /** Resolve availability for the trip. Real = Kevin's endpoint; stub = interval engine. */
  availability: AvailabilityResolver;
  /** Generate the itinerary text. Real = RocketRide; default = deterministic template. */
  generateItinerary?: ItineraryGenerator;
  /** Optional: recall+decide over the Neo4J culture graph. Injected like availability. */
  cultureBrief?: (userIds: string[], destination: string | null) => Promise<GroupBrief | null>;
}

export async function plan(
  signal: TripSignal,
  decision: RouteDecision,
  groupId: string,
  clients: Clients,
  deps: PlanDeps,
): Promise<PlanResult> {
  if (!decision.act) {
    throw new Error(`plan() called on non-actionable path: ${decision.reason}`);
  }

  const trip = await upsertTripFromSignal(signal, groupId, clients);
  const scheduling = await clients.state.updateTrip(trip.id, { status: "scheduling" });

  const participantIds = signal.participants.map((p) => p.userId);
  const { candidates, pendingConnects } = await deps.availability(scheduling, participantIds);

  // Personalize from the Neo4J culture graph (heritage food picks + flight origins).
  const cultureBrief = deps.cultureBrief
    ? await deps.cultureBrief(participantIds, signal.destination)
    : null;

  // No bookable window yet — proceed with whoever resolved (DECISION 2). Ask the
  // group to widen availability; pending participants get DM'd a connect link.
  if (!candidates.length) {
    const summary = buildSummary(scheduling, signal, candidates, cultureBrief);
    const saved = await clients.state.updateTrip(trip.id, { currentSummary: summary });
    return {
      trip: saved,
      signal,
      summary,
      candidates,
      pendingConnects,
      nextStep: "gather-availability",
      cultureBrief,
    };
  }

  // Auto-pick the best window and render the itinerary (DECISION 1).
  const chosenWindow = candidates[0]!;
  const facts = await gatherItineraryFacts(clients, participantIds, cultureBrief, signal.destination);
  const generate = deps.generateItinerary ?? (async (i) => renderItineraryTemplate(i));
  const itinerary = await generate({
    destination: scheduling.destination,
    window: chosenWindow,
    facts,
  });

  const planned = await clients.state.updateTrip(trip.id, {
    currentSummary: itinerary,
    status: "planned",
  });

  await recordPlannedTrip(clients, groupId, participantIds, scheduling.destination, chosenWindow);

  // The recap (state) and the itinerary (the move) are distinct; keep both.
  const summary = buildSummary(planned, signal, candidates, cultureBrief);
  return {
    trip: planned,
    signal,
    summary,
    candidates,
    chosenWindow,
    itinerary,
    pendingConnects,
    nextStep: "itinerary",
    cultureBrief,
  };
}

const DIETARY = /vegetarian|vegan|halal|kosher|gluten|pescatarian|no meat|dairy|nut/i;

/**
 * Reduce an XTrace belief value to a clean diet token. Live XTrace returns prose
 * recall ("User is vegetarian., The conversation consisted of a single dietary…"),
 * which must NOT bleed verbatim into the itinerary's diet line. Prefer the matched
 * dietary keyword; else the first short clause; else drop it.
 */
function cleanDiet(value: string): string | null {
  const m = value.match(DIETARY);
  if (m) return m[0].toLowerCase();
  const first = value.split(/[.,;\n]/)[0]?.trim() ?? "";
  return first && first.length <= 24 ? first : null;
}

/** Pull durable diet/budget beliefs from XTrace + a one-line culture note. */
async function gatherItineraryFacts(
  clients: Clients,
  participantIds: string[],
  cultureBrief: GroupBrief | null,
  _destination: string | null,
): Promise<ItineraryFacts> {
  const diets = new Set<string>();
  let budget: string | undefined;

  for (const id of participantIds) {
    // "diet" beliefs are dietary by definition; "food" beliefs only when they look it.
    for (const f of await clients.memory.current(id, "diet")) {
      const d = f.value ? cleanDiet(f.value) : null;
      if (d) diets.add(d);
    }
    for (const f of await clients.memory.current(id, "food")) {
      if (f.value && DIETARY.test(f.value)) {
        const d = cleanDiet(f.value);
        if (d) diets.add(d);
      }
    }
    if (!budget) {
      const b = await clients.memory.current(id, "budget");
      if (b[0]?.value) budget = b[0].value;
    }
  }

  return { diets: [...diets], budget, cultureNote: cultureNote(cultureBrief) };
}

/** A single terse food-picks line from the culture brief, or null. */
function cultureNote(brief: GroupBrief | null): string | null {
  const picks = brief?.destinationFit?.picks ?? [];
  const spots = picks.filter((p) => p.spot).map((p) => p.spot).slice(0, 3);
  return spots.length ? `Food picks: ${spots.join(", ")}.` : null;
}

/** Write the chosen plan into XTrace so future trips inherit context. */
async function recordPlannedTrip(
  clients: Clients,
  groupId: string,
  participantIds: string[],
  destination: string,
  window: CandidateWeekend,
): Promise<void> {
  const now = Date.now();
  await clients.memory.write({
    subjectId: groupId,
    subjectKind: "group",
    predicate: "plannedTrip",
    value: `${destination} (${window.label})`,
    confidence: 0.9,
    source: "pipeline-plan",
    ts: now,
  });
  for (const id of participantIds) {
    await clients.memory.write({
      subjectId: id,
      subjectKind: "user",
      predicate: "availabilityWindow",
      value: window.label,
      confidence: 0.8,
      source: "pipeline-plan",
      ts: now,
    });
  }
}
