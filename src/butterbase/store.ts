import { randomUUID } from "node:crypto";
import type {
  PollCompletedReason,
  PollKind,
  PollVoteRecord,
} from "../contracts/types.js";

/**
 * Butterbase: transactional trip / poll / vote state.
 *
 * InMemoryStore enforces the contract's idempotency rules for tests and local dev.
 * ButterbaseStore (butterbase-store.ts) persists the same interface to the live API.
 */

export type ParticipantStatus = "pending" | "voted";

export interface Trip {
  id: string;
  chatGuid: string;
  destination: string | null;
  timeframe: string | null;
  createdAt: string;
}

export interface Group {
  chatGuid: string;
  participants: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Poll {
  id: string;
  tripId: string;
  chatGuid: string;
  kind: PollKind;
  title: string;
  options: string[];
  triggerMessageId: string;
  externalPollGuid: string | null;
  participantSnapshot: string[];
  createdAt: string;
}

export interface TripParticipant {
  tripId: string;
  handle: string;
  status: ParticipantStatus;
}

export interface Store {
  upsertTrip(input: {
    chatGuid: string;
    destination: string | null;
    timeframe: string | null;
  }): Promise<Trip>;
  findTripById(tripId: string): Promise<Trip | undefined>;
  upsertGroup(chatGuid: string, participants: string[]): Promise<Group>;

  findPollByTriggerMessageId(messageId: string): Promise<Poll | undefined>;
  findPollByChatAndKind(chatGuid: string, kind: PollKind): Promise<Poll | undefined>;
  findPollById(pollId: string): Promise<Poll | undefined>;
  findPollByExternalGuid(guid: string): Promise<Poll | undefined>;

  createPoll(input: {
    tripId: string;
    chatGuid: string;
    kind: PollKind;
    title: string;
    options: string[];
    triggerMessageId: string;
  }): Promise<Poll>;
  attachExternalPollGuid(pollId: string, guid: string): Promise<void>;
  setParticipantSnapshot(pollId: string, participants: string[]): Promise<void>;
  closePoll(pollId: string, reason: PollCompletedReason): Promise<void>;

  insertVoteIfAbsent(vote: PollVoteRecord): Promise<boolean>;
  getVotes(pollId: string): Promise<PollVoteRecord[]>;

  setTripParticipants(tripId: string, handles: string[]): Promise<void>;
  markParticipantVoted(tripId: string, handle: string): Promise<void>;
  getTripParticipants(tripId: string): Promise<TripParticipant[]>;
}

export class InMemoryStore implements Store {
  private readonly trips = new Map<string, Trip>();
  private readonly tripByChat = new Map<string, string>();
  private readonly groups = new Map<string, Group>();
  private readonly polls = new Map<string, Poll>();
  private readonly pollByTrigger = new Map<string, string>();
  private readonly pollByExternalGuid = new Map<string, string>();
  private readonly votes = new Map<string, Map<string, PollVoteRecord>>();
  private readonly tripParticipants = new Map<string, Map<string, TripParticipant>>();

  async upsertTrip(input: {
    chatGuid: string;
    destination: string | null;
    timeframe: string | null;
  }): Promise<Trip> {
    const existingId = this.tripByChat.get(input.chatGuid);
    if (existingId) {
      const existing = this.trips.get(existingId)!;
      existing.destination = input.destination ?? existing.destination;
      existing.timeframe = input.timeframe ?? existing.timeframe;
      return existing;
    }
    const trip: Trip = {
      id: randomUUID(),
      chatGuid: input.chatGuid,
      destination: input.destination,
      timeframe: input.timeframe,
      createdAt: new Date().toISOString(),
    };
    this.trips.set(trip.id, trip);
    this.tripByChat.set(trip.chatGuid, trip.id);
    return trip;
  }

  async findTripById(tripId: string): Promise<Trip | undefined> {
    return this.trips.get(tripId);
  }

  async upsertGroup(chatGuid: string, participants: string[]): Promise<Group> {
    const now = new Date().toISOString();
    const existing = this.groups.get(chatGuid);
    if (existing) {
      existing.participants = participants;
      existing.updatedAt = now;
      return existing;
    }
    const group: Group = {
      chatGuid,
      participants,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.set(chatGuid, group);
    return group;
  }

  async findPollByTriggerMessageId(messageId: string): Promise<Poll | undefined> {
    const id = this.pollByTrigger.get(messageId);
    return id ? this.polls.get(id) : undefined;
  }

  async findPollByChatAndKind(
    chatGuid: string,
    kind: PollKind,
  ): Promise<Poll | undefined> {
    for (const poll of this.polls.values()) {
      if (poll.chatGuid === chatGuid && poll.kind === kind) return poll;
    }
    return undefined;
  }

  async findPollById(pollId: string): Promise<Poll | undefined> {
    return this.polls.get(pollId);
  }

  async findPollByExternalGuid(guid: string): Promise<Poll | undefined> {
    const id = this.pollByExternalGuid.get(guid);
    return id ? this.polls.get(id) : undefined;
  }

  async createPoll(input: {
    tripId: string;
    chatGuid: string;
    kind: PollKind;
    title: string;
    options: string[];
    triggerMessageId: string;
  }): Promise<Poll> {
    for (const poll of this.polls.values()) {
      if (poll.tripId === input.tripId && poll.kind === input.kind) {
        throw new Error(
          `poll already exists for trip ${input.tripId} kind ${input.kind}`,
        );
      }
    }
    const poll: Poll = {
      id: randomUUID(),
      tripId: input.tripId,
      chatGuid: input.chatGuid,
      kind: input.kind,
      title: input.title,
      options: input.options,
      triggerMessageId: input.triggerMessageId,
      externalPollGuid: null,
      participantSnapshot: [],
      createdAt: new Date().toISOString(),
    };
    this.polls.set(poll.id, poll);
    this.pollByTrigger.set(poll.triggerMessageId, poll.id);
    return poll;
  }

  async attachExternalPollGuid(pollId: string, guid: string): Promise<void> {
    const poll = this.polls.get(pollId);
    if (!poll) return;
    poll.externalPollGuid = guid;
    this.pollByExternalGuid.set(guid, pollId);
  }

  async setParticipantSnapshot(
    pollId: string,
    participants: string[],
  ): Promise<void> {
    const poll = this.polls.get(pollId);
    if (poll) poll.participantSnapshot = participants;
  }

  async closePoll(_pollId: string, _reason: PollCompletedReason): Promise<void> {
    // No-op for in-memory; Butterbase persists closed state.
  }

  async insertVoteIfAbsent(vote: PollVoteRecord): Promise<boolean> {
    let byHandle = this.votes.get(vote.poll_id);
    if (!byHandle) {
      byHandle = new Map();
      this.votes.set(vote.poll_id, byHandle);
    }
    if (byHandle.has(vote.participant_handle)) return false;
    byHandle.set(vote.participant_handle, vote);
    return true;
  }

  async getVotes(pollId: string): Promise<PollVoteRecord[]> {
    return [...(this.votes.get(pollId)?.values() ?? [])];
  }

  async setTripParticipants(tripId: string, handles: string[]): Promise<void> {
    let byHandle = this.tripParticipants.get(tripId);
    if (!byHandle) {
      byHandle = new Map();
      this.tripParticipants.set(tripId, byHandle);
    }
    for (const handle of handles) {
      if (!byHandle.has(handle)) {
        byHandle.set(handle, { tripId, handle, status: "pending" });
      }
    }
  }

  async markParticipantVoted(tripId: string, handle: string): Promise<void> {
    const byHandle = this.tripParticipants.get(tripId);
    const tp = byHandle?.get(handle);
    if (tp) tp.status = "voted";
  }

  async getTripParticipants(tripId: string): Promise<TripParticipant[]> {
    return [...(this.tripParticipants.get(tripId)?.values() ?? [])];
  }
}
