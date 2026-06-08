import {
  ERROR_CODES,
  IntentEventSchema,
  type CreateAvailabilityPollRequest,
  type CreateAvailabilityPollResponse,
  type IntentEvent,
} from "../contracts/types.js";
import type { ButterbaseIngress } from "../butterbase/ingress-client.js";
import type { PollAdapter } from "../photon/imessage-adapter.js";
import { resolveChatGuid } from "../photon/chat-resolver.js";
import type { RocketRideOrchestrator } from "./pipeline.js";
import { evaluateIntentEventGate } from "./intent-event-gate.js";
import { mapIntentEventToClassification } from "./intent-event-mapper.js";
import { STAGES, stage, stageError } from "../observability/logger.js";

const POLL_SEND_MAX_ATTEMPTS = 3;

export interface IntentEventProcessorDeps {
  adapter: PollAdapter;
  ingress: ButterbaseIngress;
  orchestrator: RocketRideOrchestrator;
  confidenceThreshold: number;
}

/**
 * Canonical path: IntentEvent upsert → gate → map → Butterbase ingress → Photon poll send.
 */
export class IntentEventProcessor {
  private readonly processedMessageIds = new Set<string>();

  constructor(private readonly deps: IntentEventProcessorDeps) {}

  async process(raw: unknown): Promise<void> {
    const parsed = IntentEventSchema.safeParse(raw);
    if (!parsed.success) {
      stageError(ERROR_CODES.INTENT_GATE_FAILED, {
        reason: "invalid intent_events row",
      });
      return;
    }

    const event = parsed.data;
    if (this.processedMessageIds.has(event.message_id)) return;

    stage(STAGES.INTENT_RECEIVED, {
      message_id: event.message_id,
      chat_id: event.chat_id,
      confidence: event.confidence,
      location: event.location,
    });

    const gate = evaluateIntentEventGate(event, this.deps.confidenceThreshold);
    if (!gate.passed) {
      stage(STAGES.INTENT_GATE_FAILED, {
        message_id: event.message_id,
        reason: gate.reason,
        error_code: gate.code,
      });
      return;
    }

    const chatGuid = await resolveChatGuid({
      chatId: event.chat_id,
      chatName: event.chat_name ?? null,
      chatKind: event.chat_kind ?? null,
    });
    if (!chatGuid) {
      stageError(ERROR_CODES.CHAT_RESOLUTION_FAILED, {
        message_id: event.message_id,
        chat_id: event.chat_id,
        chat_name: event.chat_name,
      });
      return;
    }

    const classification = mapIntentEventToClassification(event, chatGuid);
    stage(STAGES.INTENT_MAPPED, {
      message_id: event.message_id,
      chat_guid: chatGuid,
      destination: classification.extracted.destination,
    });

    const participants = await this.deps.adapter.getParticipants(chatGuid);
    const handles = participants.map((p) => p.handle);

    const outcome = await this.deps.ingress.acceptClassification({
      classification,
      participant_handles: handles,
    });
    if (outcome.status === "skipped") return;

    this.processedMessageIds.add(event.message_id);

    const response = await this.sendPollWithRetry(outcome.request, outcome.poll_id);
    if (!response) return;

    await this.deps.ingress.recordPollSent(response);
    this.deps.orchestrator.registerOpenPoll({
      pollId: outcome.poll_id,
      correlationId: outcome.request.correlation_id,
      tripId: outcome.trip_id,
      participantHandles: outcome.participant_handles,
    });
  }

  private async sendPollWithRetry(
    request: CreateAvailabilityPollRequest,
    pollId: string,
  ): Promise<CreateAvailabilityPollResponse | null> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= POLL_SEND_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.deps.adapter.createPoll(request);
        if (response.status === "sent") {
          return { ...response, poll_id: pollId };
        }
        lastErr = new Error(response.error ?? "poll status not sent");
      } catch (err) {
        lastErr = err;
      }
    }
    stageError(ERROR_CODES.POLL_SEND_FAILED, {
      correlation_id: request.correlation_id,
      chat_guid: request.target.chat_guid,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    return null;
  }

  /** Re-fetch recent intent_events after reconnect (Butterbase realtime gap). */
  async catchUp(rows: unknown[]): Promise<void> {
    for (const row of rows) {
      await this.process(row);
    }
  }
}
