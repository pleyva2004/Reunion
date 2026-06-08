import { resolveGroupChatGuidByName } from "./imessage-local-db.js";

export interface ChatResolverInput {
  chatId: string;
  chatName: string | null;
  chatKind: string | null;
}

/**
 * Resolve XTrace chat_id to advanced-imessage-kit chat_guid.
 *
 * Contract: docs/contracts/intent-to-poll-integration.md (Step 1.5)
 */
export async function resolveChatGuid(input: ChatResolverInput): Promise<string | null> {
  const chatId = input.chatId.trim();
  if (chatId.startsWith("iMessage;")) {
    return chatId;
  }

  const name = input.chatName?.trim();
  if (name) {
    const byName = await resolveGroupChatGuidByName(name);
    if (byName) return byName;
  }

  return null;
}
