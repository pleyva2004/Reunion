import { randomUUID } from "node:crypto";
import { listChatParticipantHandles } from "./imessage-local-db.js";
import type { PollAdapter } from "./imessage-adapter.js";
import type {
  CreateAvailabilityPollRequest,
  CreateAvailabilityPollResponse,
  OptionText,
  ParticipantSnapshot,
  PollVoteEvent,
} from "../contracts/types.js";

export interface MockChat {
  participants: string[];
  /** handle -> display name */
  contacts?: Record<string, string>;
}

interface CreatedPoll {
  pollId: string;
  guid: string;
  chatGuid: string;
  options: string[];
}

/**
 * In-memory PollAdapter. Runs anywhere (no macOS / iMessage server).
 * Lets a demo or test script seed chats and emit votes programmatically.
 */
export class MockPollAdapter implements PollAdapter {
  private readonly chats = new Map<string, MockChat>();
  private readonly handlers = new Set<(event: PollVoteEvent) => void>();
  private readonly polls = new Map<string, CreatedPoll>(); // by guid
  private shouldFail = false;

  constructor(chats: Record<string, MockChat> = {}) {
    for (const [chatGuid, chat] of Object.entries(chats)) {
      this.chats.set(chatGuid, chat);
    }
  }

  seedChat(chatGuid: string, chat: MockChat): void {
    this.chats.set(chatGuid, chat);
  }

  /** Force the next createPoll to fail (for POLL_SEND_FAILED tests). */
  failNextCreate(fail = true): void {
    this.shouldFail = fail;
  }

  async createPoll(
    request: CreateAvailabilityPollRequest,
  ): Promise<CreateAvailabilityPollResponse> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("mock poll send failure");
    }
    const pollId = randomUUID();
    const guid = `mock-poll-${pollId}`;
    this.polls.set(guid, {
      pollId,
      guid,
      chatGuid: request.target.chat_guid,
      options: request.poll.options,
    });
    return {
      correlation_id: request.correlation_id,
      poll_id: pollId,
      external_poll_guid: guid,
      status: "sent",
      sent_at: new Date().toISOString(),
      error: null,
    };
  }

  async getParticipants(chatGuid: string): Promise<ParticipantSnapshot[]> {
    const chat = this.chats.get(chatGuid);
    if (chat?.participants.length) {
      return chat.participants.map((handle) => ({ handle }));
    }
    const handles = await listChatParticipantHandles(chatGuid);
    return handles.map((handle) => ({ handle }));
  }

  async getContactNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const chat of this.chats.values()) {
      for (const [handle, name] of Object.entries(chat.contacts ?? {})) {
        map.set(handle, name);
      }
    }
    return map;
  }

  onVote(handler: (event: PollVoteEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Test/demo helper: simulate a participant casting a vote. */
  emitVote(
    pollGuid: string,
    participantHandle: string,
    optionText: OptionText,
  ): void {
    const poll = this.polls.get(pollGuid);
    if (!poll) throw new Error(`unknown mock poll guid: ${pollGuid}`);
    const optionIndex = poll.options.indexOf(optionText);
    const event: PollVoteEvent = {
      event: "poll_vote",
      poll_message_guid: pollGuid,
      chat_guid: poll.chatGuid,
      votes: [
        {
          participant_handle: participantHandle,
          option_identifier: `${pollGuid}:opt-${optionIndex}`,
          option_text: optionText,
        },
      ],
    };
    for (const handler of this.handlers) handler(event);
  }

  async connect(): Promise<void> {
    /* no-op */
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
