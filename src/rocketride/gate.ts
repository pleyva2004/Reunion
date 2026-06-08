import {
  ERROR_CODES,
  PLATFORM,
  type ErrorCode,
  type IntentClassificationResult,
} from "../contracts/types.js";

/**
 * Intent gate (Step 1). Downstream steps MUST NOT run unless this passes.
 *
 * Rules (docs/contracts/intent-to-poll-integration.md):
 *   should_orchestrate === true
 *   travel_intent.detected === true
 *   travel_intent.confidence >= threshold (default 0.6)
 *   platform === "imessage"
 *   chat_guid present
 */

export type GateResult =
  | { passed: true }
  | { passed: false; code: ErrorCode; reason: string };

const CHAT_GUID_PATTERN = /\S/;

export function evaluateGate(
  result: IntentClassificationResult,
  confidenceThreshold: number,
): GateResult {
  if (!result.chat_guid || !CHAT_GUID_PATTERN.test(result.chat_guid)) {
    return {
      passed: false,
      code: ERROR_CODES.MISSING_CHAT_GUID,
      reason: "chat_guid absent or invalid",
    };
  }
  if (result.platform !== PLATFORM) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: `platform must be ${PLATFORM}`,
    };
  }
  if (!result.should_orchestrate) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: "should_orchestrate is false",
    };
  }
  if (!result.travel_intent.detected) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: "travel_intent not detected",
    };
  }
  if (result.travel_intent.confidence < confidenceThreshold) {
    return {
      passed: false,
      code: ERROR_CODES.INTENT_GATE_FAILED,
      reason: `confidence ${result.travel_intent.confidence} < ${confidenceThreshold}`,
    };
  }
  return { passed: true };
}
