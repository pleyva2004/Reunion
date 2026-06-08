import {
  ERROR_CODES,
  type CreateAvailabilityPollRequest,
  type CreateAvailabilityPollResponse,
  type InboundMessage,
  type PollVoteEvent,
} from "../contracts/types.js";
import type { Classifier } from "../intent/classifier.js";
import type { ButterbaseIngress } from "../butterbase/ingress-client.js";
import type { RocketRideOrchestrator } from "../rocketride/pipeline.js";
import { evaluateGate } from "../rocketride/gate.js";
import { STAGES, stage, stageError } from "../observability/logger.js";
import type { PollAdapter } from "./imessage-adapter.js";

export interface PhotonConnectorDeps {
  classifier: Classifier;
  adapter: PollAdapter;
  ingress: ButterbaseIngress;
  orchestrator: RocketRideOrchestrator;
  confidenceThreshold: number;
}

const POLL_SEND_MAX_ATTEMPTS = 3;

/**
 * Photon connector: on-device classification, Butterbase poll creation ingress,
 * native poll send, and vote persistence to Butterbase.
 */
export class PhotonConnector {
  private unsubscribeVotes: (() => void) | null = null;

  constructor(private readonly deps: PhotonConnectorDeps) {}

  start(): void {
    if (this.unsubscribeVotes) return;
    this.unsubscribeVotes = this.deps.adapter.onVote((event) => {
      void this.handleVoteEvent(event);
    });
  }

  stop(): void {
    this.unsubscribeVotes?.();
    this.unsubscribeVotes = null;
  }

  /** Spectrum webhook entry: classify on-device -> gate -> Butterbase -> send poll. */
  async handleInbound(message: InboundMessage): Promise<void> {
    const classification = await this.deps.classifier.classify(message);
    stage(STAGES.INTENT_CLASSIFIED, {
      message_id: classification.message_id,
      chat_guid: classification.chat_guid,
      confidence: classification.travel_intent.confidence,
      signal: classification.travel_intent.signal,
      extracted: classification.extracted,
    });

    const gate = evaluateGate(classification, this.deps.confidenceThreshold);
    if (!gate.passed) {
      stageError(gate.code, { reason: gate.reason, chat_guid: message.chatGuid });
      return;
    }

    const participants = await this.deps.adapter.getParticipants(message.chatGuid);
    const handles = participants.map((p) => p.handle);

    stage(STAGES.INTENT_FORWARDED, {
      message_id: classification.message_id,
      chat_guid: classification.chat_guid,
    });

    const outcome = await this.deps.ingress.acceptClassification({
      classification,
      participant_handles: handles,
    });
    if (outcome.status === "skipped") return;

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

  async handleVoteEvent(event: PollVoteEvent): Promise<void> {
    const normalized = await this.deps.ingress.recordVote(event);
    for (const { record, inserted } of normalized) {
      if (inserted) {
        this.deps.orchestrator.recordVote(record.poll_id, record.participant_handle);
      }
    }
  }
}
