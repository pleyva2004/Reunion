import { describe, expect, it } from "vitest";
import type { IntentEvent } from "../contracts/types.js";
import { mapIntentEventToClassification } from "./intent-event-mapper.js";

describe("mapIntentEventToClassification", () => {
  it("maps live Butterbase shape to IntentClassificationResult", () => {
    const row: IntentEvent = {
      message_id: "DCDBCA84-FB81-4227-B99A-A1529937D489",
      channel: "iMessage",
      chat_id: "74dee8a88e7d4f14b423ebffe91db839",
      chat_name: "Dev",
      chat_kind: "group",
      sender: "(me)",
      is_from_me: true,
      text: "Guys we need to go to San Diego",
      context_window: "Guys we need to go to San Diego",
      is_travel_intent: true,
      confidence: 1,
      location: "San Diego",
      created_at: "2026-06-05T22:28:15.701Z",
    };

    const mapped = mapIntentEventToClassification(row, "iMessage;+;chat-dev");
    expect(mapped.message_id).toBe(row.message_id);
    expect(mapped.chat_guid).toBe("iMessage;+;chat-dev");
    expect(mapped.platform).toBe("imessage");
    expect(mapped.extracted.destination).toBe("San Diego");
    expect(mapped.extracted.timeframe).toBeNull();
    expect(mapped.travel_intent.signal).toBe("mixed");
    expect(mapped.should_orchestrate).toBe(true);
  });
});
