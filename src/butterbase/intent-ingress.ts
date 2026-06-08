import { randomUUID } from "node:crypto";
import {
  CreateAvailabilityPollRequestSchema,
  POLL_OPTIONS,
  type CreateAvailabilityPollRequest,
  type IntentClassificationResult,
} from "../contracts/types.js";
import type { Store } from "./store.js";
import { STAGES, stage } from "../observability/logger.js";

export interface IntentIngressInput {
  classification: IntentClassificationResult;
  participant_handles: string[];
  poll_title?: string;
}

export type IntentIngressOutcome =
  | {
      status: "created";
      request: CreateAvailabilityPollRequest;
      poll_id: string;
      trip_id: string;
      participant_handles: string[];
    }
  | { status: "skipped"; reason: string };

/**
 * Butterbase poll-creation ingress.
 *
 * Receives a passing on-device classification from Photon, upserts trip/poll
 * state, and returns the poll-send instructions. RocketRide is not in this path.
 */
export class IntentIngressService {
  constructor(
    private readonly store: Store,
    private readonly defaultPollTitle = "Can everyone make this trip?",
  ) {}

  async acceptClassification(
    input: IntentIngressInput,
  ): Promise<IntentIngressOutcome> {
    const classification = input.classification;
    const triggerMessageId = classification.message_id;
    const handles = input.participant_handles;

    if (await this.store.findPollByTriggerMessageId(triggerMessageId)) {
      return { status: "skipped", reason: "duplicate trigger_message_id" };
    }
    if (
      await this.store.findPollByChatAndKind(classification.chat_guid, "availability")
    ) {
      return { status: "skipped", reason: "availability poll already exists for chat" };
    }

    const trip = await this.store.upsertTrip({
      chatGuid: classification.chat_guid,
      destination: classification.extracted.destination,
      timeframe: classification.extracted.timeframe,
    });

    await this.store.upsertGroup(classification.chat_guid, handles);
    await this.store.setTripParticipants(trip.id, handles);

    const poll = await this.store.createPoll({
      tripId: trip.id,
      chatGuid: classification.chat_guid,
      kind: "availability",
      title: input.poll_title ?? this.defaultPollTitle,
      options: POLL_OPTIONS,
      triggerMessageId,
    });
    await this.store.setParticipantSnapshot(poll.id, handles);

    const correlationId = randomUUID();
    const request = CreateAvailabilityPollRequestSchema.parse({
      correlation_id: correlationId,
      trip_id: trip.id,
      target: { chat_guid: classification.chat_guid, platform: "imessage" },
      poll: {
        title: poll.title,
        options: poll.options,
        kind: "availability",
      },
      context: {
        destination: classification.extracted.destination,
        timeframe: classification.extracted.timeframe,
        trigger_message_id: triggerMessageId,
      },
    });

    stage(STAGES.POLL_REQUESTED, {
      correlation_id: correlationId,
      chat_guid: classification.chat_guid,
      options: poll.options,
      poll_id: poll.id,
    });

    return {
      status: "created",
      request,
      poll_id: poll.id,
      trip_id: trip.id,
      participant_handles: handles,
    };
  }

  async recordPollSent(
    pollId: string,
    externalPollGuid: string,
    correlationId: string,
  ): Promise<void> {
    await this.store.attachExternalPollGuid(pollId, externalPollGuid);
    stage(STAGES.POLL_SENT, {
      correlation_id: correlationId,
      poll_id: pollId,
      external_poll_guid: externalPollGuid,
    });
  }
}
