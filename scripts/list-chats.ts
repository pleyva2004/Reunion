/**
 * List iMessage group chats from the local Messages database.
 *
 * Prerequisites:
 *   - macOS with Messages.app configured
 *   - Full Disk Access granted to your terminal (System Settings → Privacy)
 *
 * Usage:
 *   npm run list:chats
 *   npm run list:chats -- --groups-only
 */
import { IMessageSDK } from "@photon-ai/imessage-kit";

const groupsOnly = process.argv.includes("--groups-only");

async function main(): Promise<void> {
  const sdk = new IMessageSDK();
  try {
    const chats = groupsOnly
      ? await sdk.listChats({ kind: "group" })
      : await sdk.listChats();

    if (chats.length === 0) {
      console.log("No chats found.");
      return;
    }

    console.log(`\n${chats.length} chat(s):\n`);
    for (const chat of chats) {
      const label = chat.name || "(unnamed)";
      console.log(`  ${label}`);
      console.log(`    chatGuid: ${chat.chatId}`);
      if (chat.unreadCount > 0) {
        console.log(`    unread:   ${chat.unreadCount}`);
      }
      console.log();
    }

    console.log(
      "Use a chatGuid with:\n" +
        "  PHOTON_MODE=real npm run live:imessage -- \"<chatGuid>\"\n" +
        "  npm run send-poll:dev   # sends to the Dev group (auto-resolved)\n",
    );
  } finally {
    await sdk.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("unable to open database") || message.includes("DATABASE")) {
    console.error(
      "\nCannot read Messages database.\n" +
        "  1. Open System Settings → Privacy & Security → Full Disk Access\n" +
        "  2. Enable access for Terminal (or Cursor)\n" +
        "  3. Ensure Messages.app is signed into iMessage\n",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
