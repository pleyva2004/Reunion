/**
 * Pull the dev trip from Butterbase and send a plain-text itinerary
 * to its group chat via @photon-ai/imessage-kit (local Messages.app).
 *
 * Usage: tsx scripts/send-itinerary.ts
 */
import { config } from "../src/config.js";

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
  title: string;
  options: string;
  participant_snapshot: string;
  status: string;
}

async function bbGet<T>(path: string): Promise<T> {
  const url = `${config.butterbase.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.butterbase.apiKey}` },
  });
  if (!res.ok) throw new Error(`Butterbase ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

function formatItinerary(trip: TripRow, poll: PollRow | undefined): string {
  const destination = trip.destination ?? "TBD";
  const timeframe = trip.timeframe ?? "TBD";
  const handles: string[] = poll
    ? (JSON.parse(poll.participant_snapshot) as string[])
    : [];

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
    "  Day 3  -  Balboa Park & museums",
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

async function main(): Promise<void> {
  if (!config.butterbase.apiKey || !config.butterbase.baseUrl) {
    throw new Error("Butterbase credentials missing");
  }
  const targetChatGuid = config.imessage.devChatGuid;
  if (!targetChatGuid) throw new Error("DEV_CHAT_GUID not set");

  const trips = await bbGet<TripRow[]>(
    `/trips?chat_guid=eq.${encodeURIComponent(targetChatGuid)}`,
  );
  const trip = trips[0];
  if (!trip) throw new Error(`No trip in Butterbase for chat ${targetChatGuid}`);
  console.log(`Trip: ${trip.destination} (${trip.id})`);

  const polls = await bbGet<PollRow[]>(`/polls?trip_id=eq.${trip.id}`);
  const poll = polls[0];

  const body = formatItinerary(trip, poll);
  console.log("\n--- Message ---\n" + body + "\n---------------\n");

  const { IMessageSDK } = (await import(
    "@photon-ai/imessage-kit"
  )) as typeof import("@photon-ai/imessage-kit");

  const sdk = new IMessageSDK();
  try {
    await sdk.send({ to: trip.chat_guid, text: body });
    console.log(`Sent to ${trip.chat_guid}`);
  } finally {
    await sdk.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
