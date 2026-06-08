import { describe, expect, it } from "vitest";
import { ERROR_CODES, type IntentEvent } from "../contracts/types.js";
import { evaluateIntentEventGate, isPollEcho } from "./intent-event-gate.js";

function event(overrides: Partial<IntentEvent> = {}): IntentEvent {
  return {
    message_id: "msg-1",
    channel: "iMessage",
    chat_id: "abc123",
    chat_name: "Dev",
    chat_kind: "group",
    sender: "alice",
    is_from_me: false,
    text: "Let's go to San Diego",
    context_window: "Let's go to San Diego",
    is_travel_intent: true,
    confidence: 0.9,
    location: "San Diego",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("isPollEcho", () => {
  it("detects poll title echoes", () => {
    expect(isPollEcho("Can everyone make this trip?\n\n• Yes\n• No")).toBe(true);
  });

  it("allows normal travel text", () => {
    expect(isPollEcho("Guys we need to go to San Diego")).toBe(false);
  });
});

describe("evaluateIntentEventGate", () => {
  it("passes a valid travel intent row", () => {
    expect(evaluateIntentEventGate(event(), 0.6)).toEqual({ passed: true });
  });

  it("fails below confidence threshold", () => {
    const gate = evaluateIntentEventGate(event({ confidence: 0.4 }), 0.6);
    expect(gate.passed).toBe(false);
    if (!gate.passed) expect(gate.code).toBe(ERROR_CODES.INTENT_GATE_FAILED);
  });

  it("rejects poll echo text", () => {
    const gate = evaluateIntentEventGate(
      event({ text: "Can everyone make this trip?" }),
      0.6,
    );
    expect(gate.passed).toBe(false);
  });
});
