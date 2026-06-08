import type {
  CreateAvailabilityPollResponse,
  PollVoteEvent,
} from "../contracts/types.js";
import type { NormalizedVote } from "../rocketride/vote-normalizer.js";
import { normalizeVoteEvent } from "../rocketride/vote-normalizer.js";
import {
  IntentIngressService,
  type IntentIngressInput,
  type IntentIngressOutcome,
} from "./intent-ingress.js";
import type { Store } from "./store.js";

/**
 * Butterbase ingress surface that Photon calls for poll creation and vote persistence.
 */
export interface ButterbaseIngress {
  acceptClassification(input: IntentIngressInput): Promise<IntentIngressOutcome>;
  recordPollSent(response: CreateAvailabilityPollResponse): Promise<void>;
  recordVote(event: PollVoteEvent): Promise<NormalizedVote[]>;
}

/** In-process ingress for the monolithic dev server and tests. */
export class InProcessButterbaseIngress implements ButterbaseIngress {
  constructor(
    private readonly intent: IntentIngressService,
    private readonly store: Store,
  ) {}

  acceptClassification(input: IntentIngressInput): Promise<IntentIngressOutcome> {
    return this.intent.acceptClassification(input);
  }

  async recordPollSent(response: CreateAvailabilityPollResponse): Promise<void> {
    if (response.status !== "sent" || !response.external_poll_guid) return;
    await this.intent.recordPollSent(
      response.poll_id,
      response.external_poll_guid,
      response.correlation_id,
    );
  }

  recordVote(event: PollVoteEvent): Promise<NormalizedVote[]> {
    return normalizeVoteEvent(event, this.store);
  }
}
