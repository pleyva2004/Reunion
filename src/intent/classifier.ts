import type {
  InboundMessage,
  IntentClassificationResult,
  TravelIntentSignal,
} from "../contracts/types.js";

/**
 * First-pass travel-intent classifier (ADR-007 / ADR-014).
 *
 * The gate downstream blocks cloud orchestration unless this clears threshold.
 * The demo implementation is a lightweight, explainable heuristic; it can be
 * swapped for a local model or a cloud classifier behind the same interface.
 */
export interface Classifier {
  classify(message: InboundMessage): Promise<IntentClassificationResult>;
}

const PLANNING_KEYWORDS = [
  "trip",
  "travel",
  "vacation",
  "getaway",
  "let's go",
  "lets go",
  "plan",
  "planning",
  "book",
  "weekend away",
  "road trip",
  "fly to",
  "flights to",
];

const DESTINATION_HINTS = [
  "to ",
  "in ",
  "visit",
  "cabin",
  "beach",
  "mountains",
  "city",
];

const DATE_KEYWORDS = [
  "weekend",
  "next month",
  "this summer",
  "in july",
  "in august",
  "labor day",
  "memorial day",
  "spring break",
  "thanksgiving",
  "new year",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Heuristic, deterministic classifier suitable for demos and tests. */
export class HeuristicClassifier implements Classifier {
  async classify(
    message: InboundMessage,
  ): Promise<IntentClassificationResult> {
    const text = message.text;
    const lower = text.toLowerCase();

    const hasPlanning = PLANNING_KEYWORDS.some((k) => lower.includes(k));
    const hasDate =
      DATE_KEYWORDS.some((k) => lower.includes(k)) ||
      MONTHS.some((m) => lower.includes(m));
    const destination = extractDestination(text);
    const hasDestination = destination !== null;

    const signal = pickSignal(hasPlanning, hasDestination, hasDate);
    const confidence = scoreConfidence(hasPlanning, hasDestination, hasDate);
    const detected = confidence > 0;

    return {
      message_id: message.messageId,
      chat_guid: message.chatGuid,
      platform: message.platform,
      text,
      classified_at: new Date().toISOString(),
      travel_intent: { detected, confidence, signal },
      extracted: {
        destination,
        timeframe: extractTimeframe(lower),
        participants_mentioned: extractParticipants(text),
      },
      should_orchestrate: detected,
    };
  }
}

function scoreConfidence(
  planning: boolean,
  destination: boolean,
  date: boolean,
): number {
  let score = 0;
  if (planning) score += 0.5;
  if (destination) score += 0.3;
  if (date) score += 0.3;
  // Two or more independent signals strongly imply real planning intent.
  const signals = [planning, destination, date].filter(Boolean).length;
  if (signals >= 2) score += 0.1;
  return Math.min(1, Number(score.toFixed(2)));
}

function pickSignal(
  planning: boolean,
  destination: boolean,
  date: boolean,
): TravelIntentSignal {
  const signals = [planning, destination, date].filter(Boolean).length;
  if (signals >= 2) return "mixed";
  if (planning) return "explicit_planning";
  if (destination) return "destination_mention";
  if (date) return "date_mention";
  return "explicit_planning";
}

function extractDestination(text: string): string | null {
  // Capture a proper-noun phrase after "to"/"in" (e.g. "to Lake Tahoe").
  const match = text.match(
    /\b(?:to|in|visit(?:ing)?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/,
  );
  if (match?.[1]) return match[1].trim();
  // Fall back to a generic destination hint without a captured name.
  const lower = text.toLowerCase();
  for (const hint of DESTINATION_HINTS) {
    if (hint.trim().length > 2 && lower.includes(hint)) {
      const idx = lower.indexOf(hint);
      const tail = text.slice(idx + hint.length).split(/[.,!?]/)[0]?.trim();
      if (tail) return tail;
    }
  }
  return null;
}

function extractTimeframe(lower: string): string | null {
  for (const k of DATE_KEYWORDS) {
    if (lower.includes(k)) return k;
  }
  for (const m of MONTHS) {
    if (lower.includes(m)) return m;
  }
  return null;
}

function extractParticipants(text: string): string[] {
  // Pull @mentions and capitalized first names that follow "with".
  const out = new Set<string>();
  for (const m of text.matchAll(/@(\w+)/g)) {
    if (m[1]) out.add(m[1]);
  }
  const withMatch = text.match(/\bwith\s+([A-Z][a-zA-Z]+(?:[,&]?\s+[A-Z][a-zA-Z]+)*)/);
  if (withMatch?.[1]) {
    for (const name of withMatch[1].split(/[,&]|\band\b/)) {
      const trimmed = name.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}
