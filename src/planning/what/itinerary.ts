/**
 * Itinerary generation — the final "what" artifact.  [Owner: Jossue]
 *
 * Turns the auto-picked window + destination + group facts (diet/budget from XTrace,
 * culture brief) into a short, plain-text, decision-oriented itinerary for iMessage
 * (Local mode: text only, no Markdown — PRD §18/§23).
 *
 * Generation goes through a RocketRide LLM pipeline (visible to judges) and degrades
 * to a deterministic template on timeout / stubs / any failure — the same recoverable
 * pattern as the extractor (DECISION 3).
 */
import type { CandidateWeekend } from "../../contracts/index.js";
import type { RocketRideLike } from "../../pipeline/extractRocketRide.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ItineraryFacts {
  diets: string[]; // distinct dietary needs across the group
  budget?: string | null; // group budget posture, if known
  cultureNote?: string | null; // one-line note from the culture brief
}

export interface ItineraryInput {
  destination: string;
  window: CandidateWeekend;
  facts: ItineraryFacts;
}

export type ItineraryGenerator = (input: ItineraryInput) => Promise<string>;

// ── Deterministic template (the always-available fallback) ──────────────────────

/** Number of whole days the window spans (end is exclusive). */
function dayCount(window: CandidateWeekend): number {
  return Math.max(1, Math.round((window.end - window.start) / DAY));
}

/**
 * Render a terse, believable plain-text itinerary with no external data. Generic by
 * design — the RocketRide path produces the richer version; this guarantees the demo
 * always sends *something* coherent.
 */
export function renderItineraryTemplate(input: ItineraryInput): string {
  const { destination, window, facts } = input;
  const days = dayCount(window);
  const lines: string[] = [`Trip plan — ${destination}, ${window.label}`, ""];

  for (let i = 0; i < days; i++) {
    const date = new Date(window.start + i * DAY);
    const dow = WEEKDAYS[date.getUTCDay()];
    lines.push(`Day ${i + 1} (${dow})`);
    if (i === 0) {
      lines.push(`- Arrive in ${destination}, settle in`);
      lines.push("- Group dinner near the center");
    } else if (i === days - 1) {
      lines.push("- Slow morning, last walk around");
      lines.push("- Head to the airport");
    } else {
      lines.push("- Morning: a neighborhood + a landmark");
      lines.push("- Afternoon: free time / optional activity");
      lines.push("- Dinner together");
    }
    lines.push("");
  }

  const notes: string[] = [];
  if (facts.diets.length) notes.push(`Diet: ${facts.diets.join(", ")}-friendly picks throughout.`);
  if (facts.budget) notes.push(`Budget: ${facts.budget}.`);
  if (facts.cultureNote) notes.push(facts.cultureNote);
  if (notes.length) {
    lines.push(...notes, "");
  }

  lines.push("Reply 👍 if this works.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── RocketRide path ─────────────────────────────────────────────────────────────

export function buildItineraryPrompt(input: ItineraryInput): string {
  const { destination, window, facts } = input;
  const days = dayCount(window);
  const constraints = [
    facts.diets.length ? `dietary needs: ${facts.diets.join(", ")}` : null,
    facts.budget ? `budget posture: ${facts.budget}` : null,
    facts.cultureNote ? `group note: ${facts.cultureNote}` : null,
  ].filter(Boolean);

  return `You are a concise group-travel planner. Write a LIGHT ${days}-day itinerary for a trip to ${destination} on ${window.label}.

Rules:
- Plain text ONLY. No Markdown, no asterisks, no headers — iMessage strips formatting.
- One "Day N (Dow)" header per day, then EXACTLY 1-2 short bullets starting with "- ".
- Keep the whole thing under ~10 lines. Terse group-chat tone, not a brochure.
- Honor these constraints: ${constraints.length ? constraints.join("; ") : "none stated"}.
- First line: "Trip plan — ${destination}, ${window.label}".
- Last line: "Reply 👍 if this works."

Return ONLY the itinerary text.`;
}

/** Coerce a pipeline result into the itinerary string; throw if empty so we fall back. */
export function coerceItineraryText(raw: unknown): string {
  const text = extractText(raw);
  const trimmed = stripCodeFence(text).trim();
  if (!trimmed) throw new Error("empty itinerary result");
  return trimmed;
}

function extractText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.length ? extractText(raw[0]) : "";
  if (isObject(raw)) {
    if (Array.isArray(raw.answers) && raw.answers.length) return extractText(raw.answers[0]);
    if ("result" in raw) return extractText(raw.result);
    if ("text" in raw && typeof raw.text === "string") return raw.text;
  }
  return "";
}

function stripCodeFence(s: string): string {
  const m = s.trim().match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return m?.[1] ?? s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`itinerary timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export interface ItineraryConnectConfig {
  uri?: string;
  auth?: string;
  pipelinePath: string;
  timeoutMs?: number;
}

export interface ItineraryGeneratorDeps {
  clientFactory: () => RocketRideLike | Promise<RocketRideLike>;
  pipelinePath: string;
  timeoutMs?: number;
}

/** RocketRide-backed generator that degrades to the template on any failure. */
export class RocketRideItinerary {
  constructor(private readonly deps: ItineraryGeneratorDeps) {}

  async generate(input: ItineraryInput): Promise<string> {
    // Itinerary has its OWN (short) timeout, independent of the extractor's. It's
    // generated once per acting message, so a long degrade window stacks up across
    // the demo — keep it tight and fall back to the template fast.
    const ms = this.deps.timeoutMs ?? (Number(process.env.ROCKETRIDE_ITINERARY_TIMEOUT_MS) || 20000);
    const ref: { client?: RocketRideLike } = {};
    try {
      return await withTimeout(this.run(input, ref), ms);
    } catch {
      return renderItineraryTemplate(input);
    } finally {
      if (ref.client) {
        try {
          await ref.client.disconnect();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }

  private async run(input: ItineraryInput, ref: { client?: RocketRideLike }): Promise<string> {
    ref.client = await this.deps.clientFactory();
    await ref.client.connect();
    const { token } = await ref.client.use({ filepath: this.deps.pipelinePath });
    const raw = await ref.client.send(
      token,
      buildItineraryPrompt(input),
      { name: "itinerary-request.txt" },
      "text/plain",
    );
    await ref.client.terminate(token);
    return coerceItineraryText(raw);
  }
}

const ROCKETRIDE_MODULE = "rocketride";

export interface ItineraryConfig {
  useStubs: boolean;
  rocketride?: { uri?: string; auth?: string; pipelinePath: string };
}

/** Choose the itinerary implementation from config (mirrors resolveExtract). */
export function resolveItinerary(cfg: ItineraryConfig): ItineraryGenerator {
  if (!cfg.useStubs && cfg.rocketride) {
    return createRocketRideItinerary(cfg.rocketride);
  }
  return async (input) => renderItineraryTemplate(input);
}

export function createRocketRideItinerary(config: ItineraryConnectConfig): ItineraryGenerator {
  const gen = new RocketRideItinerary({
    pipelinePath: config.pipelinePath,
    timeoutMs: config.timeoutMs,
    clientFactory: async () => {
      const mod: any = await import(ROCKETRIDE_MODULE);
      return new mod.RocketRideClient({ uri: config.uri, auth: config.auth }) as RocketRideLike;
    },
  });
  return (input) => gen.generate(input);
}
