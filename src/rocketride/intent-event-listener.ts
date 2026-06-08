import WebSocket from "ws";
import type { ButterbaseConfig } from "../butterbase/api.js";
import { ButterbaseClient } from "../butterbase/api.js";
import { logger } from "../observability/logger.js";
import type { IntentEventProcessor } from "./intent-event-processor.js";

export interface IntentEventListenerOptions {
  butterbase: ButterbaseConfig;
  processor: IntentEventProcessor;
  /** Re-fetch recent rows on connect/reconnect. */
  catchUpLimit?: number;
}

type RealtimeMessage =
  | { type: "connected" }
  | { type: "subscribed"; table: string }
  | { type: "change"; table: string; op: string; record: unknown }
  | { type: "error"; message: string }
  | { type: "heartbeat" };

/**
 * Subscribes to Butterbase realtime INSERT on intent_events.
 * See docs/contracts/intent-to-poll-integration.md (Step 0.5).
 */
export class IntentEventListener {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly client: ButterbaseClient;

  constructor(private readonly opts: IntentEventListenerOptions) {
    this.client = new ButterbaseClient(opts.butterbase);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const realtime = await this.client.ensureIntentEventsRealtime();
    if (!realtime.enabled) {
      logger.warn(
        { tables: realtime.tables },
        "intent_events realtime not enabled — run Butterbase MCP configure_realtime or events will not arrive",
      );
    }
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;

    const base = this.opts.butterbase.baseUrl.replace(/\/$/, "");
    const wsUrl = `${base.replace(/^http/, "ws")}/realtime`;

    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${this.opts.butterbase.apiKey}` },
    });

    this.ws.on("open", () => {
      void this.onOpen();
    });

    this.ws.on("message", (data) => {
      void this.onMessage(data.toString());
    });

    this.ws.on("close", () => {
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.warn({ err }, "intent_events realtime websocket error");
    });
  }

  private async onOpen(): Promise<void> {
    this.ws?.send(
      JSON.stringify({ type: "subscribe", table: "intent_events" }),
    );
    await this.catchUpRecent();
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(raw) as RealtimeMessage;
    } catch {
      return;
    }

    if (msg.type === "change" && msg.table === "intent_events" && msg.op === "INSERT") {
      await this.opts.processor.process(msg.record);
    }
    if (msg.type === "error") {
      logger.warn({ message: msg.message }, "intent_events realtime error");
    }
  }

  private async catchUpRecent(): Promise<void> {
    const limit = this.opts.catchUpLimit ?? 20;
    try {
      const rows = await this.client.listIntentEvents({
        is_travel_intent: "eq.true",
        order: "created_at.desc",
        limit: String(limit),
      });
      await this.opts.processor.catchUp(rows.reverse());
    } catch (err) {
      logger.warn({ err }, "intent_events catch-up fetch failed");
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
  }
}
