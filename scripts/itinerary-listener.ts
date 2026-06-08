/**
 * Listen for new rows in Butterbase `trips` and send an itinerary
 * text message to the trip's group chat via @photon-ai/imessage-kit.
 *
 * Usage: tsx scripts/itinerary-listener.ts
 */
import WebSocket from "ws";
import { config } from "../src/config.js";
import { logger } from "../src/observability/logger.js";

interface TripRow {
  id: string;
  chat_guid: string;
  destination: string | null;
  timeframe: string | null;
  created_at: string;
}

interface PollRow {
  id: string;
  trip_id: string;
  participant_snapshot: string;
}

type RealtimeMessage =
  | { type: "connected" }
  | { type: "subscribed"; table: string }
  | { type: "change"; table: string; op: string; record: unknown }
  | { type: "error"; message: string }
  | { type: "heartbeat" };

async function bbGet<T>(path: string): Promise<T> {
  const url = `${config.butterbase.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.butterbase.apiKey}` },
  });
  if (!res.ok) throw new Error(`Butterbase ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function formatItinerary(trip: TripRow, handles: string[]): string {
  const destination = trip.destination ?? "TBD";
  const timeframe = trip.timeframe ?? "TBD";
  const lines = [
    "==============================",
    `   REUNION TRIP: ${destination.toUpperCase()}`,
    "==============================",
    "",
    `  Destination .... ${destination}`,
    `  When ........... ${timeframe}`,
    `  Crew ........... ${handles.length} traveler${handles.length === 1 ? "" : "s"}`,
    "",
    "------------------------------",
    "  ITINERARY",
    "------------------------------",
    "  Day 1  -  Arrival & welcome dinner",
    "  Day 2  -  Beach day + sunset cruise",
    "  Day 3  -  Local exploration & museums",
    "  Day 4  -  Free day / group brunch",
    "  Day 5  -  Departure",
    "",
    "------------------------------",
    "  ROSTER",
    "------------------------------",
  ];
  for (const h of handles) lines.push(`  - ${h}`);
  if (handles.length === 0) lines.push("  (roster pending)");
  lines.push("", "Reply YES to lock it in.");
  return lines.join("\n");
}

class ItineraryListener {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly sentTrips = new Set<string>();
  // LIFO: newest trip is processed first. Older pending trips remain on the
  // stack and are popped after the newer ones drain.
  private readonly pending: TripRow[] = [];
  private draining = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;

  async start(): Promise<void> {
    const { IMessageSDK } = (await import(
      "@photon-ai/imessage-kit"
    )) as typeof import("@photon-ai/imessage-kit");
    this.sdk = new IMessageSDK();
    logger.info("imessage-kit SDK initialized");
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    void this.sdk?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const base = (config.butterbase.baseUrl ?? "").replace(/\/$/, "");
    const wsUrl = `${base.replace(/^http/, "ws")}/realtime?token=${encodeURIComponent(
      config.butterbase.apiKey ?? "",
    )}`;
    this.ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${config.butterbase.apiKey}` },
    });

    this.ws.on("open", () => {
      logger.info({ wsUrl }, "realtime connected; subscribing to trips");
      this.ws?.send(JSON.stringify({ type: "subscribe", table: "trips" }));
    });
    this.ws.on("message", (raw) => void this.onMessage(raw.toString()));
    this.ws.on("close", () => {
      logger.warn("realtime closed; reconnecting in 5s");
      this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
    });
    this.ws.on("error", (err) => logger.warn({ err }, "realtime error"));
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(raw) as RealtimeMessage;
    } catch {
      return;
    }
    if (msg.type !== "heartbeat") {
      logger.info({ msg }, "realtime msg");
    }
    if (msg.type === "subscribed") {
      logger.info({ table: msg.table }, "subscribed");
      return;
    }
    if (msg.type !== "change" || msg.table !== "trips" || msg.op !== "INSERT") {
      return;
    }
    const trip = msg.record as TripRow;
    if (!trip?.id || this.sentTrips.has(trip.id)) return;
    this.pending.push(trip);
    logger.info({ trip_id: trip.id, stack_size: this.pending.length }, "queued (LIFO)");
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const trip = this.pending.pop()!;
        if (this.sentTrips.has(trip.id)) continue;
        this.sentTrips.add(trip.id);
        try {
          await this.sendForTrip(trip);
        } catch (err) {
          logger.error({ err, trip_id: trip.id }, "failed to send itinerary");
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async sendForTrip(trip: TripRow): Promise<void> {
    const polls = await bbGet<PollRow[]>(`/polls?trip_id=eq.${trip.id}`);
    const handles: string[] = polls[0]
      ? (JSON.parse(polls[0].participant_snapshot) as string[])
      : [];
    const body = formatItinerary(trip, handles);
    logger.info(
      { trip_id: trip.id, chat_guid: trip.chat_guid, destination: trip.destination },
      "sending itinerary",
    );
    await this.sdk.send({ to: trip.chat_guid, text: body });
    logger.info({ trip_id: trip.id }, "itinerary sent");
  }
}

async function main(): Promise<void> {
  if (!config.butterbase.baseUrl || !config.butterbase.apiKey) {
    throw new Error("Butterbase credentials missing");
  }
  const listener = new ItineraryListener();
  await listener.start();
  logger.info("itinerary listener running (Ctrl+C to stop)");

  const stop = () => {
    logger.info("stopping listener");
    listener.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
