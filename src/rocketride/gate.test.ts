import { describe, it, expect } from "vitest";
import { evaluateGate } from "./gate.js";
import {
  ERROR_CODES,
  type IntentClassificationResult,
} from "../contracts/types.js";

function result(
  overrides: Partial<IntentClassificationResult> = {},
): IntentClassificationResult {
  return {
    message_id: "m-1",
    chat_guid: "iMessage;+;chat123",
    platform: "imessage",
    text: "let's plan a trip",
    classified_at: new Date().toISOString(),
    travel_intent: { detected: true, confidence: 0.8, signal: "mixed" },
    extracted: {
      destination: "Tahoe",
      timeframe: "summer",
      participants_mentioned: [],
    },
    should_orchestrate: true,
    ...overrides,
  };
}

describe("evaluateGate", () => {
  it("passes when all rules are satisfied", () => {
    expect(evaluateGate(result(), 0.6)).toEqual({ passed: true });
  });

  it("fails with MISSING_CHAT_GUID when chat_guid is empty", () => {
    const gate = evaluateGate(result({ chat_guid: "" }), 0.6);
    expect(gate.passed).toBe(false);
    expect(gate).toMatchObject({ code: ERROR_CODES.MISSING_CHAT_GUID });
  });

  it("fails when confidence is below threshold", () => {
    const gate = evaluateGate(
      result({ travel_intent: { detected: true, confidence: 0.5, signal: "mixed" } }),
      0.6,
    );
    expect(gate.passed).toBe(false);
    expect(gate).toMatchObject({ code: ERROR_CODES.INTENT_GATE_FAILED });
  });

  it("passes exactly at the threshold", () => {
    const gate = evaluateGate(
      result({ travel_intent: { detected: true, confidence: 0.6, signal: "mixed" } }),
      0.6,
    );
    expect(gate.passed).toBe(true);
  });

  it("fails when should_orchestrate is false", () => {
    const gate = evaluateGate(result({ should_orchestrate: false }), 0.6);
    expect(gate.passed).toBe(false);
    expect(gate).toMatchObject({ code: ERROR_CODES.INTENT_GATE_FAILED });
  });

  it("fails when travel_intent is not detected", () => {
    const gate = evaluateGate(
      result({ travel_intent: { detected: false, confidence: 0.9, signal: "mixed" } }),
      0.6,
    );
    expect(gate.passed).toBe(false);
  });
});
