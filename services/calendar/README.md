# Group Travel Planning Agent (Reunion)

Reunion is a messaging-native group travel planning agent built for the Agentic AI SF Hackathon. It detects travel intent in group chat, remembers constraints and preferences, and turns casual conversation into concrete coordination steps.

## Project objective

Build a WhatsApp-first prototype that proves one full loop:

1. Group travel intent appears in chat.
2. The system extracts planning entities and constraints.
3. Durable memory and app state are updated.
4. The agent posts a useful next coordination action back in chat.

## Why this exists

Group travel planning usually fails because coordination state is fragmented across messages, people, and tools. Reunion treats this as a coordination-memory problem, not just a search problem.

## Core architecture

- **Messaging interface:** Photon / Spectrum (WhatsApp-first)
- **Workflow orchestration:** RocketRide
- **Durable memory:** XTrace
- **Application backend state:** Butterbase

## Repository documentation

- Product requirements: `docs/PRD.md`
- Documentation overview: `docs/README.md`
- Architecture decisions: `ADR/README.md` and `ADR/ADR-*.md`

## Current status

The repository docs are synced to the Notion project page, PRD page, and ADR decision database linked from:

- [Group Travel Planning Agent (Notion)](https://www.notion.so/staffroomai/Group-Travel-Planning-Agent-870322eb3917415dae037a918e07f1e9?source=copy_link)

---

# Reunion · Calendar Integration

V1 calendar component for a group-trip agent. See [CLAUDE.md](./CLAUDE.md),
[INTERFACE.md](./INTERFACE.md), [SCOPE_NOTES.md](./SCOPE_NOTES.md) for the full spec.

Two surfaces:
- `/connect` + `/oauth/callback` — Google Calendar OAuth (testing-mode, `calendar.freebusy` scope)
- `POST /api/availability` — availability engine returning per-participant `busy`/`free` + `common_free`

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill in env values, then:
pnpm dev
```

### Required env vars

| var | what |
| --- | --- |
| `APP_URL` | Base URL of this app. Local: `http://localhost:3000`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Create an OAuth client of type **Web application**. |
| `GOOGLE_REDIRECT_URI` | Must match a URI authorized on the OAuth client. Default: `${APP_URL}/oauth/callback`. |
| `STATE_SIGNING_KEY` | HMAC key for signed state tokens. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `INTERNAL_API_KEY` | Shared secret required in `x-internal-key` header on `POST /api/availability`. |
| `ALLOWED_TEST_EMAILS` | CSV of Google account emails permitted to complete OAuth (the app runs in Testing mode). |
| `BUTTERBASE_APP_ID` / `BUTTERBASE_API_KEY` | From your [Butterbase](https://butterbase.ai) app. Optional locally — without them, an in-process memory store is used (state is lost on restart). |

### Google Cloud setup (one-time)

1. Create or pick a project at https://console.cloud.google.com/.
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen as **External** + **Testing**. Add the test user emails to the allowlist.
4. Create an **OAuth 2.0 Client ID** of type Web application.
5. Add `${APP_URL}/oauth/callback` to "Authorized redirect URIs".
6. Copy client ID + secret into `.env.local`.

### Butterbase setup (one-time)

The storage adapter expects two tables: `participants` and `oauth_tokens`. Provision via the
Butterbase MCP, CLI, or dashboard:

- `participants` — `id` (uuid pk), `phone` (text unique), `google_email` (text nullable), `created_at`, `updated_at`
- `oauth_tokens` — `participant_id` (uuid pk, unique), `access_token`, `refresh_token` (nullable), `expires_at` (bigint, epoch ms), `scope`, `updated_at`

The Butterbase API key passed via `BUTTERBASE_API_KEY` is used as the `anonKey` and must have read+write on both tables.

## Verifying M1 (OAuth loop)

1. Start the dev server: `pnpm dev`.
2. Seed a participant and generate a signed connect URL:
   ```bash
   pnpm seed-link trip-test +15551234567
   ```
3. Open the printed `connect URL` in a browser logged into a Google account on the
   `ALLOWED_TEST_EMAILS` list. Complete the consent flow.
4. You should land on `/oauth/done`. Tokens are persisted in storage; check Butterbase (or
   the in-memory log) for the `oauth_tokens` row.

## Verifying M2 (availability engine)

After completing M1 for at least one phone, hit the engine:

```bash
curl -sS -X POST http://localhost:3000/api/availability \
  -H "content-type: application/json" \
  -H "x-internal-key: $INTERNAL_API_KEY" \
  -d '{
    "trip_id": "trip-test",
    "window": { "start": "2026-07-10", "end": "2026-07-20" },
    "participants": [
      { "phone": "+15551234567" },
      { "phone": "+15559999999" }
    ]
  }' | jq
```

Expected behaviors:
- Connected participant: `resolved:true`, `source:"freebusy"`, `busy` + `free` populated.
- Unknown phone: `resolved:false`, `needs_connect_link:true`, `connect_url:"…"`.
- Missing `x-internal-key`: 401.

See [INTERFACE.md](./INTERFACE.md) for the full output shape.

## Deploy

```bash
vercel link
vercel env add ...  # populate every required env var
vercel deploy
```

For real Google OAuth, the redirect URI on the Google client must match the deployed
`${APP_URL}/oauth/callback`. Easiest path: set `APP_URL` to your stable Vercel domain (not a
per-deploy URL) and add the same URL to the Google client's authorized redirect URIs.

## File layout

```
app/
  connect/route.ts            GET — verify signed state, redirect to Google consent
  oauth/callback/route.ts     GET — exchange code, persist tokens
  oauth/done/page.tsx         success page
  api/availability/route.ts   POST — main engine, shared-secret auth
lib/
  config.ts                   env loader
  state.ts                    HMAC sign/verify of {tripId, participantId, exp}
  connect-link.ts             buildConnectLink(tripId, participantId)
  google.ts                   OAuth + freebusy + refresh + TokenRevokedError tagging
  storage.ts                  Butterbase tables or in-memory fallback
  availability.ts             subtractBusy + intersectFree + window normalization
scripts/
  seed-connect-link.ts        seed a participant by phone and print a connect URL
```
