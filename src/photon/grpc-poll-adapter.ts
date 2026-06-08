import { randomUUID } from "node:crypto";
import type { PollAdapter } from "./imessage-adapter.js";
import type {
  CreateAvailabilityPollRequest,
  CreateAvailabilityPollResponse,
  ParticipantSnapshot,
  PollVoteEvent,
} from "../contracts/types.js";
import { listChatParticipantHandles } from "./imessage-local-db.js";
import { logger } from "../observability/logger.js";

export interface GrpcPollAdapterOptions {
  address: string;
  token: string | (() => Promise<string>);
  tls?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GrpcClient = any;

/**
 * Poll adapter backed by @photon-ai/advanced-imessage gRPC (dedicated server).
 *
 * Configure with IMESSAGE_GRPC_ADDRESS + IMESSAGE_GRPC_TOKEN.
 */
export class GrpcPollAdapter implements PollAdapter {
  private client: GrpcClient | null = null;
  private readonly handlers = new Set<(event: PollVoteEvent) => void>();
  private readonly optionTextById = new Map<string, Map<string, string>>();
  private unsubscribeEvents: (() => void) | null = null;

  constructor(private readonly options: GrpcPollAdapterOptions) {}

  async connect(): Promise<void> {
    const { createClient } = (await import(
      /* @vite-ignore */ "@photon-ai/advanced-imessage"
    )) as { createClient: (opts: unknown) => GrpcClient };
    this.client = createClient({
      address: this.options.address,
      token: this.options.token,
      tls: this.options.tls ?? true,
    });
    this.ensureSubscribed();
  }

  private ensureSubscribed(): void {
    if (!this.client || this.unsubscribeEvents) return;
    const stream = this.client.polls.subscribeEvents();
    this.unsubscribeEvents = stream.on((event: {
      type: string;
      chatGuid: string;
      pollMessageGuid: string;
      actor?: { address: string };
      delta: { type: string; optionIdentifier?: string };
    }) => {
      if (event.type !== "poll.changed") return;
      if (event.delta.type !== "voted" || !event.delta.optionIdentifier) return;
      const actor = event.actor?.address;
      if (!actor) return;

      const optionId = event.delta.optionIdentifier;
      const optionText =
        this.optionTextById.get(event.pollMessageGuid)?.get(optionId) ?? optionId;

      const voteEvent: PollVoteEvent = {
        event: "poll_vote",
        poll_message_guid: event.pollMessageGuid,
        chat_guid: event.chatGuid,
        votes: [
          {
            participant_handle: actor,
            option_identifier: optionId,
            option_text: optionText,
          },
        ],
      };
      for (const handler of this.handlers) handler(voteEvent);
    });
  }

  async createPoll(
    request: CreateAvailabilityPollRequest,
  ): Promise<CreateAvailabilityPollResponse> {
    if (!this.client) await this.connect();
    const poll = await this.client!.polls.create(
      request.target.chat_guid,
      request.poll.title,
      request.poll.options,
    );

    const optionMap = new Map<string, string>();
    for (const option of poll.options) {
      optionMap.set(option.optionIdentifier, option.text);
    }
    this.optionTextById.set(poll.pollMessageGuid, optionMap);

    return {
      correlation_id: request.correlation_id,
      poll_id: randomUUID(),
      external_poll_guid: poll.pollMessageGuid,
      status: "sent",
      sent_at: new Date().toISOString(),
      error: null,
    };
  }

  async getParticipants(chatGuid: string): Promise<ParticipantSnapshot[]> {
    // Spectrum cloud gRPC denies group-chat GetChat; local Messages DB is authoritative.
    const localHandles = await listChatParticipantHandles(chatGuid);
    if (localHandles.length > 0) {
      return localHandles.map((handle) => ({ handle }));
    }

    if (this.client) {
      try {
        const chat = await this.client.chats.get(chatGuid);
        const participants = chat.participants ?? [];
        if (participants.length > 0) {
          return participants.map((p: { address: string }) => ({ handle: p.address }));
        }
      } catch (err) {
        logger.warn({ err, chat_guid: chatGuid }, "grpc chat lookup failed");
      }
    }

    throw new Error(`No participants found for chat ${chatGuid}`);
  }

  async getContactNameMap(): Promise<Map<string, string>> {
    return new Map();
  }

  onVote(handler: (event: PollVoteEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    if (this.client) {
      try {
        await this.client.close();
      } catch (err) {
        logger.warn({ err }, "error closing grpc imessage client");
      }
      this.client = null;
    }
  }
}
