import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { IMessageSDK, type Message } from "@photon-ai/imessage-kit";
import { startClassifier, classify, type Verdict } from "./classifier.js";

// We read at the imessage-kit layer (beneath Spectrum) on purpose: Reunion is an
// ambient observer that must check EVERY message in the group, including the ones
// sent from this Mac's own account. Spectrum's message stream drops self-sent
// messages with no opt-in; imessage-kit's watcher exposes both incoming and
// from-me messages.

// Only watch these chats (by display name, case-insensitive). Override with
// REUNION_CHATS="Dev,Trip squad". Messages in any other chat are ignored.
const ALLOWED_CHATS = (process.env.REUNION_CHATS ?? "Dev")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// How many recent messages per conversation to feed the classifier. Travel
// intent often emerges across turns ("we should travel" -> "yeah" -> "where").
const WINDOW = 5;

const buffers = new Map<string, string[]>();

function pushWindow(chatId: string, text: string): string {
  const buf = buffers.get(chatId) ?? [];
  buf.push(text);
  while (buf.length > WINDOW) buf.shift();
  buffers.set(chatId, buf);
  return buf.join("\n");
}

// Resolve human-readable chat names (e.g. "Dev") from chat.db so the readout
// shows the group name instead of an opaque id.
function loadChats(): Array<{ identifier: string; name: string }> {
  const out: Array<{ identifier: string; name: string }> = [];
  try {
    const dbPath = join(homedir(), "Library", "Messages", "chat.db");
    const rows = execFileSync(
      "sqlite3",
      [
        "-readonly",
        "-separator",
        "\t",
        dbPath,
        "SELECT chat_identifier, display_name FROM chat WHERE display_name IS NOT NULL AND display_name != '';",
      ],
      { encoding: "utf8" },
    );
    for (const line of rows.split("\n")) {
      if (!line.trim()) continue;
      const [identifier, name] = line.split("\t");
      if (identifier && name) out.push({ identifier, name });
    }
  } catch {
    // best effort
  }
  return out;
}

const chats = loadChats();

function chatName(chatId: string | null): string {
  if (!chatId) return "";
  const hit = chats.find((c) => chatId === c.identifier || chatId.includes(c.identifier));
  return hit?.name ?? "";
}

const RULE = "-".repeat(60);

function field(label: string, value: string): string {
  return `${label.padEnd(12)}${value}`;
}

function printReadout(args: {
  chat: string;
  sender: string;
  text: string;
  verdict: Verdict;
}): void {
  const { chat, sender, text, verdict } = args;
  console.log(
    [
      RULE,
      field("chat:", chat),
      field("from:", sender),
      field("message:", text),
      field("intent:", verdict.isTravelIntent ? "YES" : "NO"),
      field("confidence:", verdict.confidence.toFixed(2)),
      field("location:", verdict.location.trim() || "-"),
      RULE,
    ].join("\n"),
  );
}

async function handleMessage(message: Message): Promise<void> {
  if (message.kind !== "text") return;
  const text = (message.text ?? "").trim();
  if (!text) return;

  const name = chatName(message.chatId);
  if (!ALLOWED_CHATS.includes(name.toLowerCase())) return; // scope: only watched chats

  const chatId = message.chatId ?? "unknown";
  const kind = message.chatKind; // 'dm' | 'group' | 'unknown'
  const chat = name ? `${kind} "${name}"` : kind;
  const sender = message.isFromMe ? "(me)" : (message.participant ?? "unknown");

  const window = pushWindow(chatId, text);

  let verdict: Verdict;
  try {
    verdict = await classify(window);
  } catch (err) {
    console.error(`classify error: ${(err as Error).message}`);
    return;
  }

  printReadout({ chat, sender, text, verdict });
}

async function main(): Promise<void> {
  console.log("Reunion intent gate");
  console.log("Starting on-device classifier (Foundation Models)...");
  try {
    await startClassifier();
  } catch (err) {
    console.error(`Classifier unavailable: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log("Classifier ready.");

  console.log(`Watching iMessage chats: ${ALLOWED_CHATS.join(", ")} (incoming + your own)...`);
  const sdk = new IMessageSDK();
  await sdk.startWatching({
    onIncomingMessage: handleMessage,
    onFromMeMessage: handleMessage,
    onError: (err) => console.error(`watch error: ${err.message}`),
  });
  console.log("Listening. Send an iMessage to test.");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
