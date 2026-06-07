# iMessage — Connection Reference

Sourced from Context7 (`/photon-hq/imessage-kit`, `/photon-hq/advanced-imessage-kit`, `/photon-hq/skills`) on 2026-06-05.

Photon provides two iMessage SDKs. Reunion should prefer **advanced-imessage-kit** for polls, group participant metadata, and real-time events.

## SDK comparison

| Capability | `@photon-ai/imessage-kit` | `@photon-ai/advanced-imessage-kit` |
|------------|---------------------------|-------------------------------------|
| Send/receive text | Yes | Yes |
| Real-time watching | Polling (`startWatching`) | Socket.IO (`sdk.on('new-message')`) |
| Group chats | `chatId` filter | `sdk.chats.getChats()`, participants |
| Contacts / names | Limited | `sdk.contacts.getContacts()` |
| **Polls** | No | `sdk.polls.create`, vote, parse |
| Server model | Local macOS DB | Connect to iMessage server |

## Prerequisites

- macOS with Messages.app and iMessage enabled.
- For **advanced-imessage-kit**: a running iMessage server (local or remote).
- Node.js or Bun runtime.

## advanced-imessage-kit — connection

```typescript
import { SDK } from "@photon-ai/advanced-imessage-kit";

const sdk = SDK({
  serverUrl: "http://localhost:1234",  // local server default
  apiKey: "my-secret-key",               // optional, for remote/auth
  logLevel: "info",
  logToFile: true,                       // ~/Library/Logs/AdvancedIMessageKit
});

await sdk.connect(); // Socket.IO — wait for 'ready' before operating

sdk.on("ready", () => console.log("Connected and ready"));
sdk.on("disconnect", () => console.log("Disconnected"));
sdk.on("error", (err) => console.error("SDK error:", err.message));

process.on("SIGINT", async () => {
  await sdk.close();
  process.exit(0);
});
```

## Send a message

```typescript
await sdk.messages.sendMessage({
  chatGuid: "iMessage;-;+1234567890",
  message: "Hello World!",
});
```

Group chat GUID format: `iMessage;+;chat123456`

## Group chats and participants

```typescript
const chats = await sdk.chats.getChats();
const groups = chats.filter((chat) => chat.style === 43); // group chats

const contacts = await sdk.contacts.getContacts();
const nameMap = new Map<string, string>();
for (const c of contacts) {
  const name = c.displayName || c.firstName || "";
  if (!name) continue;
  for (const p of c.phoneNumbers || []) nameMap.set(p.address, name);
  for (const e of c.emails || []) nameMap.set(e.address, name);
}

groups.forEach((group) => {
  console.log(`Group: ${group.displayName || group.chatIdentifier}`);
  group.participants?.forEach((p) => {
    const name = nameMap.get(p.address);
    const display = name ? `${name} <${p.address}>` : p.address;
    console.log(`  - ${display} (${p.service})`);
  });
});
```

## Polls — create, vote, parse

### Create

```typescript
const poll = await sdk.polls.create({
  chatGuid: "iMessage;-;+14155552671",
  title: "Can you make it?",
  options: ["Can you go", "Do you want to go"],
});
console.log("Poll GUID:", poll.guid);
```

Requires at least two options.

### Vote

```typescript
await sdk.polls.vote({
  chatGuid: "iMessage;-;+14155552671",
  pollMessageGuid: poll.guid,
  optionIdentifier: poll.payloadData.item.orderedPollOptions[0].optionIdentifier,
});
```

### Parse incoming poll events

```typescript
import {
  isPollMessage,
  isPollVote,
  parsePollDefinition,
  parsePollVotes,
  getPollSummary,
  getOptionTextById,
} from "@photon-ai/advanced-imessage-kit";

sdk.on("new-message", (message) => {
  if (!isPollMessage(message)) return;

  if (isPollVote(message)) {
    const vote = parsePollVotes(message);
    vote?.votes.forEach((v) => {
      const text = getOptionTextById(v.voteOptionIdentifier) ?? v.voteOptionIdentifier;
      console.log(`${v.participantHandle} voted "${text}"`);
    });
  } else {
    const poll = parsePollDefinition(message);
    console.log("Poll:", poll?.title);
    poll?.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.text}`));
  }

  console.log(getPollSummary(message));
});
```

## imessage-kit — local DB watcher (alternative)

Use when running directly against the local Messages database without a server:

```typescript
import { IMessageSDK } from '@photon-ai/imessage-kit';

const sdk = new IMessageSDK({
  watcher: {
    pollInterval: 3000,
    unreadOnly: false,
    excludeOwnMessages: true,
  },
});

await sdk.startWatching({
  onNewMessage: async (message) => {
    await sdk.message(message).replyText('Thanks!').execute();
  },
  onGroupMessage: async (message) => {
    console.log('Group:', message.chatId);
  },
  onError: (error) => console.error('Error:', error),
});
```

Filter group messages by `chatId`:

```typescript
const groupMessages = await sdk.getMessages({
  chatId: 'chat123456',
  since: new Date('2025-01-01'),
});
```

## Reunion mapping

| Concern | iMessage surface |
|---------|------------------|
| Group identity | `chatGuid` / `chatId` |
| Participant address | `participant.address` / `participantHandle` |
| Display name | Contacts lookup via `nameMap.get(address)` |
| Availability poll | `sdk.polls.create` with title + options |
| Vote events | `isPollVote` + `parsePollVotes` |

## References

- imessage-kit: `/photon-hq/imessage-kit`
- advanced-imessage-kit: `/photon-hq/advanced-imessage-kit`
- Photon skills (poll patterns): `/photon-hq/skills`
