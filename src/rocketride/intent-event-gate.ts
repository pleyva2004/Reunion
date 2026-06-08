import {
  ERROR_CODES,
  type ErrorCode,
  type IntentEvent,
} from "../contracts/types.js";

export type IntentEventGateResult =
  | { passed: true }
  | { passed: false; code: ErrorCode; reason: string };

const IMESSAGE_CHANNELS = new Set(["imessage", "i message"]);

/** Detect poll title/option echoes re-ingested as intent (live Butterbase data). */
export function isPollEcho(text: string): boolean {
  const normalized = text.trim();
  if (/can everyone make this trip\?/i.test(normalized)) return true;
  if (/•\s*yes\b/i.test(normalized) && /•\s*no\b/i.test(normalized)) return true;
  return false;
}

export function evaluateIntentEventGate(
  event: IntentEvent,
  confidenceThreshold: number,
): IntentEventGateResult {
  if (!event.chat_id?.trim()) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: "chat_id absent",
    };
  }

  const channel = event.channel?.trim().toLowerCase() ?? "";
  if (!IMESSAGE_CHANNELS.has(channel)) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: `channel must be iMessage (got ${event.channel ?? "null"})`,
    };
  }

  if (!event.is_travel_intent) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: "is_travel_intent is false",
    };
  }

  if (event.confidence < confidenceThreshold) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: `confidence ${event.confidence} < ${confidenceThreshold}`,
    };
  }

  if (isPollEcho(event.text)) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: "poll echo text detected",
    };
  }

  return { passed: true };
}
