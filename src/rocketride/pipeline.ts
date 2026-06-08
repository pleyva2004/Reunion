import {
  ERROR_CODES,
  type PollCompletedReason,
} from "../contracts/types.js";
import type { PollAdapter } from "../photon/imessage-adapter.js";
import type { Store } from "../butterbase/store.js";
import type { Knowledge } from "../xtrace/client.js";
import { STAGES, stage, stageError } from "../observability/logger.js";
import { buildRoster } from "./roster.js";
import { CompletionTracker } from "./completion.js";

export interface RocketRideOrchestratorDeps {
  adapter: PollAdapter;
  store: Store;
  knowledge: Knowledge;
  completionTimeoutMs: number;
}

export interface OpenPollRegistration {
  pollId: string;
  correlationId: string;
  tripId: string;
  participantHandles: string[];
}

/**
 * RocketRide orchestration: reads poll/vote state from Butterbase, drives
 * completion, and emits the UserRoster to XTrace. Does not classify inbound
 * messages or create polls — that is Photon → Butterbase.
 */
export class RocketRideOrchestrator {
  private readonly completion: CompletionTracker;
  private readonly pollMeta = new Map<
    string,
    { correlationId: string; tripId: string }
  >();

  constructor(private readonly deps: RocketRideOrchestratorDeps) {
    this.completion = new CompletionTracker(deps.completionTimeoutMs);
  }

  registerOpenPoll(input: OpenPollRegistration): void {
    this.pollMeta.set(input.pollId, {
      correlationId: input.correlationId,
      tripId: input.tripId,
    });
    this.completion.register(input.pollId, input.participantHandles, (reason) => {
      void this.onPollCompleted(input.pollId, reason);
    });
  }

  recordVote(pollId: string, participantHandle: string): void {
    this.completion.recordVote(pollId, participantHandle);
  }

  stop(): void {
    this.completion.clear();
    this.pollMeta.clear();
  }

  private async onPollCompleted(
    pollId: string,
    reason: PollCompletedReason,
  ): Promise<void> {
    const meta = this.pollMeta.get(pollId);
    if (!meta) return;

    const { store } = this.deps;
    const poll = await store.findPollById(pollId);
    if (!poll) return;

    await store.closePoll(pollId, reason);

    const votes = await store.getVotes(pollId);
    const nameMap = await this.deps.adapter.getContactNameMap();

    const allVoted =
      poll.participantSnapshot.length > 0 &&
      poll.participantSnapshot.every((h) =>
        votes.some((v) => v.participant_handle === h),
      );
    const complete = reason === "all_voted" || allVoted;

    if (!complete) {
      stageError(ERROR_CODES.PARTIAL_ROSTER, {
        poll_id: pollId,
        reason,
        voted: votes.length,
        participants: poll.participantSnapshot.length,
      });
    }

    const roster = buildRoster({
      correlationId: meta.correlationId,
      tripId: meta.tripId,
      pollId,
      votes,
      nameMap,
      participantSnapshot: poll.participantSnapshot,
      complete,
    });

    stage(STAGES.ROSTER_EMITTED, {
      poll_id: pollId,
      trip_id: meta.tripId,
      reason,
      complete: roster.complete,
      users: roster.users,
    });

    const trip = await store.findTripById(meta.tripId);
    await this.deps.knowledge.writeRoster(roster, {
      chatGuid: poll.chatGuid,
      destination: trip?.destination ?? null,
      timeframe: trip?.timeframe ?? null,
      participants: poll.participantSnapshot,
    });
  }
}
