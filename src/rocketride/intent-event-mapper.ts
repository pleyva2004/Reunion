import {
  IntentClassificationResultSchema,
  type IntentClassificationResult,
  type IntentEvent,
} from "../contracts/types.js";

export function mapIntentEventToClassification(
  event: IntentEvent,
  chatGuid: string,
): IntentClassificationResult {
  return IntentClassificationResultSchema.parse({
    message_id: event.message_id,
    chat_guid: chatGuid,
    platform: "imessage",
    text: event.text,
    classified_at: event.created_at,
    travel_intent: {
      detected: event.is_travel_intent,
      confidence: event.confidence,
      signal: "mixed",
    },
    extracted: {
      destination: event.location,
      timeframe: null,
      participants_mentioned: [],
    },
    should_orchestrate: true,
  });
}
