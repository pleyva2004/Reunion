import { randomUUID } from "node:crypto";
import type { PollKind, PollCompletedReason, PollVoteRecord } from "../contracts/types.js";
import type { ButterbaseDataClient } from "./api.js";
import type {
  Group,
  Poll,
  Store,
  Trip,
  TripParticipant,
} from "./store.js";

function rowToTrip(row: Record<string, unknown>): Trip {
  return {
    id: String(row.id),
    chatGuid: String(row.chat_guid),
    destination: row.destination != null ? String(row.destination) : null,
    timeframe: row.timeframe != null ? String(row.timeframe) : null,
    createdAt: String(row.created_at),
  };
}

function rowToPoll(row: Record<string, unknown>): Poll {
  return {
    id: String(row.id),
    tripId: String(row.trip_id),
    chatGuid: String(row.chat_guid),
    kind: row.kind as PollKind,
    title: String(row.title),
    options: JSON.parse(String(row.options ?? "[]")) as string[],
    triggerMessageId: String(row.trigger_message_id),
    externalPollGuid:
      row.external_poll_guid != null ? String(row.external_poll_guid) : null,
    participantSnapshot: JSON.parse(
      String(row.participant_snapshot ?? "[]"),
    ) as string[],
    createdAt: String(row.created_at),
  };
}

function rowToVote(row: Record<string, unknown>): PollVoteRecord {
  return {
    poll_id: String(row.poll_id),
    participant_handle: String(row.participant_handle),
    option_identifier: String(row.option_identifier),
    option_text: row.option_text as PollVoteRecord["option_text"],
    voted_at: String(row.voted_at),
  };
}

function eqFilter(column: string, value: string): Record<string, string> {
  return { [column]: `eq.${value}` };
}

/**
 * Butterbase-backed Store for trip / poll / vote state.
 * Persists the poll-creation flow so dedup and votes survive restarts.
 */
export class ButterbaseStore implements Store {
  constructor(private readonly client: ButterbaseDataClient) {}

  async upsertTrip(input: {
    chatGuid: string;
    destination: string | null;
    timeframe: string | null;
  }): Promise<Trip> {
    const existing = await this.client.list("trips", eqFilter("chat_guid", input.chatGuid));
    if (existing[0]) {
      const trip = rowToTrip(existing[0]);
      const patch: Record<string, string | null> = {};
      if (input.destination != null) patch.destination = input.destination;
      if (input.timeframe != null) patch.timeframe = input.timeframe;
      if (Object.keys(patch).length > 0) {
        await this.client.patch("trips", trip.id, patch);
        return {
          ...trip,
          destination: input.destination ?? trip.destination,
          timeframe: input.timeframe ?? trip.timeframe,
        };
      }
      return trip;
    }

    const trip: Trip = {
      id: randomUUID(),
      chatGuid: input.chatGuid,
      destination: input.destination,
      timeframe: input.timeframe,
      createdAt: new Date().toISOString(),
    };
    await this.client.insert("trips", {
      id: trip.id,
      chat_guid: trip.chatGuid,
      destination: trip.destination,
      timeframe: trip.timeframe,
      created_at: trip.createdAt,
    });
    return trip;
  }

  async findTripById(tripId: string): Promise<Trip | undefined> {
    const rows = await this.client.list("trips", eqFilter("id", tripId));
    return rows[0] ? rowToTrip(rows[0]) : undefined;
  }

  async upsertGroup(chatGuid: string, participants: string[]): Promise<Group> {
    const now = new Date().toISOString();
    const existing = await this.client.list("chat_groups", eqFilter("chat_guid", chatGuid));
    if (existing[0]) {
      // Butterbase REST has no PATCH-by-filter for chat_groups; snapshot is on the poll row.
      return {
        chatGuid,
        participants,
        createdAt: String(existing[0].created_at),
        updatedAt: String(existing[0].updated_at),
      };
    }
    await this.client.insert("chat_groups", {
      chat_guid: chatGuid,
      participants: JSON.stringify(participants),
      created_at: now,
      updated_at: now,
    });
    return { chatGuid, participants, createdAt: now, updatedAt: now };
  }

  async findPollByTriggerMessageId(messageId: string): Promise<Poll | undefined> {
    const rows = await this.client.list(
      "polls",
      eqFilter("trigger_message_id", messageId),
    );
    return rows[0] ? rowToPoll(rows[0]) : undefined;
  }

  async findPollByChatAndKind(
    chatGuid: string,
    kind: PollKind,
  ): Promise<Poll | undefined> {
    const rows = await this.client.list("polls", {
      chat_guid: `eq.${chatGuid}`,
      kind: `eq.${kind}`,
    });
    return rows[0] ? rowToPoll(rows[0]) : undefined;
  }

  async findPollById(pollId: string): Promise<Poll | undefined> {
    const rows = await this.client.list("polls", eqFilter("id", pollId));
    return rows[0] ? rowToPoll(rows[0]) : undefined;
  }

  async findPollByExternalGuid(guid: string): Promise<Poll | undefined> {
    const rows = await this.client.list("polls", eqFilter("external_poll_guid", guid));
    return rows[0] ? rowToPoll(rows[0]) : undefined;
  }

  async createPoll(input: {
    tripId: string;
    chatGuid: string;
    kind: PollKind;
    title: string;
    options: string[];
    triggerMessageId: string;
  }): Promise<Poll> {
    const dup = await this.findPollByChatAndKind(input.chatGuid, input.kind);
    if (dup) {
      throw new Error(
        `poll already exists for chat ${input.chatGuid} kind ${input.kind}`,
      );
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

    await this.client.insert("polls", {
      id: poll.id,
      trip_id: poll.tripId,
      chat_guid: poll.chatGuid,
      kind: poll.kind,
      title: poll.title,
      options: JSON.stringify(poll.options),
      trigger_message_id: poll.triggerMessageId,
      external_poll_guid: null,
      participant_snapshot: JSON.stringify([]),
      status: "open",
      created_at: poll.createdAt,
    });
    return poll;
  }

  async attachExternalPollGuid(pollId: string, guid: string): Promise<void> {
    await this.client.patch("polls", pollId, { external_poll_guid: guid });
  }

  async setParticipantSnapshot(
    pollId: string,
    participants: string[],
  ): Promise<void> {
    await this.client.patch("polls", pollId, {
      participant_snapshot: JSON.stringify(participants),
    });
  }

  async closePoll(
    pollId: string,
    reason: PollCompletedReason,
  ): Promise<void> {
    await this.client.patch("polls", pollId, {
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_reason: reason,
    });
  }

  async insertVoteIfAbsent(vote: PollVoteRecord): Promise<boolean> {
    const existing = await this.client.list("poll_votes", {
      poll_id: `eq.${vote.poll_id}`,
      participant_handle: `eq.${vote.participant_handle}`,
    });
    if (existing.length > 0) return false;

    await this.client.insert("poll_votes", {
      poll_id: vote.poll_id,
      participant_handle: vote.participant_handle,
      option_identifier: vote.option_identifier,
      option_text: vote.option_text,
      voted_at: vote.voted_at,
    });
    return true;
  }

  async getVotes(pollId: string): Promise<PollVoteRecord[]> {
    const rows = await this.client.list("poll_votes", eqFilter("poll_id", pollId));
    return rows.map(rowToVote);
  }

  async setTripParticipants(tripId: string, handles: string[]): Promise<void> {
    for (const handle of handles) {
      const existing = await this.client.list("trip_participants", {
        trip_id: `eq.${tripId}`,
        handle: `eq.${handle}`,
      });
      if (existing.length === 0) {
        await this.client.insert("trip_participants", {
          trip_id: tripId,
          handle,
          status: "pending",
        });
      }
    }
  }

  async markParticipantVoted(tripId: string, handle: string): Promise<void> {
    // trip_participants uses a composite key; Butterbase REST may not support
    // PATCH-by-query. Best-effort only — poll_votes is the source of truth.
    try {
      await this.client.patchWhere(
        "trip_participants",
        { trip_id: `eq.${tripId}`, handle: `eq.${handle}` },
        { status: "voted" },
      );
    } catch {
      // non-fatal for roster completion
    }
  }

  async getTripParticipants(tripId: string): Promise<TripParticipant[]> {
    const rows = await this.client.list(
      "trip_participants",
      eqFilter("trip_id", tripId),
    );
    return rows.map((row) => ({
      tripId: String(row.trip_id),
      handle: String(row.handle),
      status: row.status as TripParticipant["status"],
    }));
  }
}
