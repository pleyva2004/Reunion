# Photon / Spectrum — iMessage Connection Reference

Sourced from Context7 (`/photon-hq/docs`, `/photon-hq/skills`) on 2026-06-05.

Photon is a unified messaging platform. **Spectrum** (`spectrum-ts`) is its SDK. Reunion uses Spectrum with the **iMessage provider only** for inbound message delivery. Polls and outbound group actions use `@photon-ai/advanced-imessage-kit` directly (see `imessage.md`).

## Prerequisites

| Variable | Purpose |
|----------|---------|
| `PROJECT_ID` | Photon project identifier |
| `PROJECT_SECRET` | Photon project secret |
| `SPECTRUM_SIGNING_SECRET` | Webhook signature verification |

Create a project with Spectrum enabled:

```sh
photon projects create --name "Reunion" --location us-east --spectrum
```

Spectrum CLI commands require an active project via `$PHOTON_PROJECT_ID` or `--project <id>`.

## Architecture pattern

Spectrum uses a **two-process model**:

1. **Webhook receiver** — inbound iMessage events (HTTP POST from Spectrum).
2. **Long-lived SDK process** — outbound text replies via `space.send(...)` when needed.

For Reunion's availability poll flow, poll create/vote is **not** handled by Spectrum — it goes through `advanced-imessage-kit`.

## iMessage-only provider setup

```typescript
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [
    imessage.config(),
    terminal.config(), // local dev only
  ],
});
```

## Inbound: webhook registration

```bash
curl -X POST "https://spectrum.photon.codes/projects/$PROJECT_ID/webhooks/" \
  -u "$PROJECT_ID:$PROJECT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://your-app.com/spectrum-webhook"}'
```

Save the `signingSecret` from the response — shown only once.

## Inbound: webhook handler

```typescript
app.post('/spectrum-webhook', async (c) => {
  if (!verify(c)) return c.text('bad signature', 401);
  const payload = JSON.parse(await c.req.text());
  if (payload.event === 'messages' && payload.message.content.type === 'text') {
    void enqueueIntentClassification({
      messageId: payload.message.id,
      chatGuid: payload.space.id, // map to chat_guid in classifier
      text: payload.message.content.text,
      platform: 'imessage',
    });
  }
  return c.text('ok', 200); // must return 2xx to prevent retries
});
```

## Webhook signature verification

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SPECTRUM_SIGNING_SECRET;
const TOLERANCE_SEC = 5 * 60;

function verify(rawBody: string, timestamp: string, signature: string): boolean {
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;

  const expected =
    'v0=' +
    createHmac('sha256', SECRET)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Outbound text (supplementary)

Use for non-poll replies (summaries, acknowledgments). Polls use `sdk.polls.create` in advanced-imessage-kit.

```typescript
import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const app = await Spectrum({
  projectId: process.env.PROJECT_ID!,
  projectSecret: process.env.PROJECT_SECRET!,
  providers: [imessage.config()],
});

export const reply = async (spaceId: string, body: string) => {
  const space = await app.spaces.get(spaceId);
  await space.send(text(body));
};
```

## Proactive iMessage group creation

```typescript
import { imessage } from 'spectrum-ts/providers/imessage';

const im = imessage(app);
const alice = await im.user('+15551111111');
const bob = await im.user('+15552222222');
const group = await im.space(alice, bob);
await group.send('Welcome to the group!');
```

## Message loop (SDK-only, no webhook)

Alternative to webhooks for local dev:

```typescript
for await (const [space, message] of app.messages) {
  await space.responding(async () => {
    await message.reply("Hello from Spectrum.");
  });
}
```

## Reunion mapping

| Concern | Spectrum surface | Poll flow |
|---------|-------------------|-----------|
| Group chat identity | `space.id` (webhook) | Map to `chat_guid` for advanced-imessage-kit |
| Inbound text | `payload.message.content.text` | Triggers intent classifier |
| Outbound text | `space.send(text(...))` | Summaries only |
| Native polls | Not supported | `sdk.polls.create` in advanced-imessage-kit |

## Known limitations

- Webhooks deliver **inbound messages only**.
- Spectrum does not expose native iMessage poll APIs — use `advanced-imessage-kit` for polls.

## References

- Photon docs: `/photon-hq/docs`
- Photon skills (Spectrum patterns): `/photon-hq/skills`
- iMessage polls + roster: `docs/connections/imessage.md`
