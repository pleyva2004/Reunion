import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_DB = join(homedir(), "Library/Messages/chat.db");

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function querySqlite(dbPath: string, sql: string): Promise<string[]> {
  const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
    timeout: 10_000,
  });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** List participant handles for a chat from the local Messages database. */
export async function listChatParticipantHandles(
  chatGuid: string,
  dbPath: string = DEFAULT_DB,
): Promise<string[]> {
  const guid = escapeSqlLiteral(chatGuid);
  const sql = `
    SELECT DISTINCT h.id
    FROM chat c
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    JOIN handle h ON chj.handle_id = h.ROWID
    WHERE c.guid = '${guid}';
  `;
  return querySqlite(dbPath, sql);
}

/** Resolve a group chat guid by display name (case-insensitive). */
export async function resolveGroupChatGuidByName(
  name: string,
): Promise<string | null> {
  const { IMessageSDK } = (await import(
    /* @vite-ignore */ "@photon-ai/imessage-kit"
  )) as { IMessageSDK: new () => { listChats: (q?: { kind?: string }) => Promise<readonly { chatId: string; name: string | null }[]>; close: () => Promise<void> } };

  const sdk = new IMessageSDK();
  try {
    const chats = await sdk.listChats({ kind: "group" });
    const needle = name.trim().toLowerCase();
    const match = chats.find((c) => (c.name ?? "").trim().toLowerCase() === needle);
    return match?.chatId ?? null;
  } finally {
    await sdk.close();
  }
}
