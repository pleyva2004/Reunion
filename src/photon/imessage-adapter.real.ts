import { randomUUID } from "node:crypto";
import type { PollAdapter } from "./imessage-adapter.js";
import type {
  CreateAvailabilityPollRequest,
  CreateAvailabilityPollResponse,
  ParticipantSnapshot,
  PollVoteEvent,
} from "../contracts/types.js";
import { logger } from "../observability/logger.js";
import { listChatParticipantHandles } from "./imessage-local-db.js";
import {
  pollSendBlockedMessage,
  probeImessageServer,
} from "./imessage-server-probe.js";

/**
 * Real Photon adapter backed by @photon-ai/advanced-imessage-kit.
 *
 * Requires macOS + Messages.app + a running iMessage server. The package is an
 * optionalDependency and is imported dynamically so the mock path works without it.
 *
 * See docs/connections/imessage.md.
 */
export interface RealAdapterOptions {
  serverUrl: string;
  apiKey?: string;
  logLevel?: string;
}

// The SDK is untyped here; keep the surface narrow and documented.
type AnySdk = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export class RealPollAdapter implements PollAdapter {
  private sdk: AnySdk | null = null;
  private kit: AnySdk | null = null;
  private readonly handlers = new Set<(event: PollVoteEvent) => void>();
  private subscribed = false;

  constructor(private readonly options: RealAdapterOptions) {}

  async connect(): Promise<void> {
    const reachable = await probeImessageServer(this.options.serverUrl);
    if (!reachable) {
      throw new Error(pollSendBlockedMessage(this.options.serverUrl));
    }

    // Dynamic import keeps the optional dependency truly optional.
    const kit = (await import(
      /* @vite-ignore */ "@photon-ai/advanced-imessage-kit"
    )) as AnySdk;
    this.kit = kit;
    this.sdk = kit.SDK({
      serverUrl: this.options.serverUrl,
      apiKey: this.options.apiKey,
      logLevel: this.options.logLevel ?? "info",
    });
    await this.sdk.connect();
    this.ensureSubscribed();
  }

  private ensureSubscribed(): void {
    if (this.subscribed || !this.sdk || !this.kit) return;
    const { isPollMessage, isPollVote, parsePollVotes, getOptionTextById } =
      this.kit;

    this.sdk.on("new-message", (message: AnySdk) => {
      if (!isPollMessage(message) || !isPollVote(message)) return;
      const parsed = parsePollVotes(message);
      if (!parsed) return;
      const event: PollVoteEvent = {
        event: "poll_vote",
        poll_message_guid: message.guid ?? parsed.pollMessageGuid ?? "",
        chat_guid: message.chatGuid ?? parsed.chatGuid ?? "",
        votes: (parsed.votes ?? []).map((v: AnySdk) => ({
          participant_handle: v.participantHandle,
          option_identifier: v.voteOptionIdentifier,
          option_text:
            getOptionTextById(v.voteOptionIdentifier) ?? v.voteOptionIdentifier,
        })),
      };
      for (const handler of this.handlers) handler(event);
    });
    this.subscribed = true;
  }

  async createPoll(
    request: CreateAvailabilityPollRequest,
  ): Promise<CreateAvailabilityPollResponse> {
    if (!this.sdk) await this.connect();
    const poll = await this.sdk.polls.create({
      chatGuid: request.target.chat_guid,
      title: request.poll.title,
      options: request.poll.options,
    });
    return {
      correlation_id: request.correlation_id,
      poll_id: randomUUID(),
      external_poll_guid: poll.guid,
      status: "sent",
      sent_at: new Date().toISOString(),
      error: null,
    };
  }

  async getParticipants(chatGuid: string): Promise<ParticipantSnapshot[]> {
    if (this.sdk) {
      try {
        const chat = await this.sdk.chats.getChat(chatGuid, { with: ["participants"] });
        const participants = chat?.participants ?? [];
        if (participants.length > 0) {
          return participants.map((p: AnySdk) => ({ handle: p.address }));
        }
      } catch (err) {
        logger.warn(
          { err, chat_guid: chatGuid },
          "kit participant lookup failed; using local Messages DB",
        );
      }
    }

    const handles = await listChatParticipantHandles(chatGuid);
    if (handles.length === 0) {
      throw new Error(`No participants found for chat ${chatGuid}`);
    }
    return handles.map((handle) => ({ handle }));
  }

  async getContactNameMap(): Promise<Map<string, string>> {
    if (!this.sdk) await this.connect();
    const contacts = await this.sdk.contacts.getContacts();
    const map = new Map<string, string>();
    for (const c of contacts) {
      const name = c.displayName || c.firstName || "";
      if (!name) continue;
      for (const p of c.phoneNumbers ?? []) map.set(p.address, name);
      for (const e of c.emails ?? []) map.set(e.address, name);
    }
    return map;
  }

  onVote(handler: (event: PollVoteEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    if (this.sdk?.close) {
      try {
        await this.sdk.close();
      } catch (err) {
        logger.warn({ err }, "error closing advanced-imessage-kit sdk");
      }
    }
  }
}
