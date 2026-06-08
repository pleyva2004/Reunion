# Butterbase — Connection Reference

Sourced from Butterbase docs (`docs.butterbase.ai`) and a live connection test against the Reunion app on 2026-06-05.

Butterbase is an AI-optimized Backend-as-a-Service: managed PostgreSQL, JWT auth, S3-compatible storage, an auto-generated REST API, and an OpenAI-compatible AI gateway. Reunion uses it as the backend datastore for participants and OAuth tokens.

## App

| Field | Value |
|-------|-------|
| App name | `reunion` |
| `app_id` | `app_4lls3kxgops9` |
| Region | `us-west-2` |
| API base | `https://api.butterbase.ai/v1/app_4lls3kxgops9` |
| Visibility | `private` |
| Provisioning | `ready` (`db_provisioned: true`) |

## Credentials

Configured in `.env` (never commit real values):

| Variable | Purpose |
|----------|---------|
| `BUTTERBASE_APP_ID` | App identifier (`app_4lls3kxgops9`) |
| `BUTTERBASE_API_KEY` | Service key, `bb_sk_` prefix — full programmatic access |
| `BUTTERBASE_BASE_URL` | App-scoped REST base URL |

Authenticate by sending the service key as a Bearer token:

```sh
curl -H "Authorization: Bearer $BUTTERBASE_API_KEY" \
  "https://api.butterbase.ai/v1/$BUTTERBASE_APP_ID/schema"
```

## Auth roles

The role is derived from the `Authorization` header:

| Request type | Header | Role |
|--------------|--------|------|
| No auth header | (none) | `butterbase_anon` |
| End-user JWT | `Bearer {jwt}` | `butterbase_user` |
| Service key | `Bearer bb_sk_...` | `butterbase_service` |

> **Note:** No row-level security policies are applied yet, so anonymous requests can currently read table rows. Add RLS (`create_rls_policy`) before exposing the API publicly.

## REST API

A full CRUD API is generated automatically once tables exist.

### Data endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/{app_id}/{table}` | List rows (filter, sort, paginate) |
| GET | `/v1/{app_id}/{table}/{id}` | Read one row by primary key |
| POST | `/v1/{app_id}/{table}` | Create a row |
| PATCH | `/v1/{app_id}/{table}/{id}` | Partial update |
| DELETE | `/v1/{app_id}/{table}/{id}` | Delete a row |

### Schema & migrations

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/{app_id}/schema` | Read current schema |
| POST | `/v1/{app_id}/schema/apply` | Apply a schema update |
| GET | `/v1/{app_id}/migrations` | List applied migrations |

### App management & health

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/apps` | List your apps |
| GET | `/health` | Liveness check (no auth) |
| GET | `/health/ready` | Readiness check, verifies DB (no auth) |

## Current schema

Eight tables exist on the live reunion app (verified 2026-06-05).

### `intent_events` (XTrace trigger)

Written by XTrace when a message is classified. One row per `message_id`. RocketRide subscribes to INSERT via Butterbase realtime to trigger poll creation.

| Column | Type | Constraint |
|--------|------|------------|
| `id` | uuid | default `gen_random_uuid()` |
| `message_id` | text | unique (`intent_events_message_id_idx`) |
| `channel` | text | e.g. `iMessage` |
| `chat_id` | text | XTrace chat identifier (hash; not `chat_guid`) |
| `chat_name` | text | Group display name for Photon resolution |
| `chat_kind` | text | `group` or `dm` |
| `sender` | text | |
| `is_from_me` | boolean | |
| `text` | text | Message body |
| `context_window` | text | Recent messages context |
| `is_travel_intent` | boolean | Gate field |
| `confidence` | float8 | Gate field (threshold 0.6) |
| `location` | text | Extracted destination |
| `created_at` | text | |

Migration: `add_intent_events` (2026-06-05).

**Realtime requirement:** `configure_realtime({ tables: ["intent_events"] })` must be enabled before RocketRide receives INSERT events. Check status: `GET /v1/{app_id}/realtime/config`.

### `participants`

| Column | Type | Constraint |
|--------|------|------------|
| `id` | text | |
| `phone` | text | unique (`participants_phone_idx`) |
| `google_email` | text | |
| `created_at` | text | |
| `updated_at` | text | |

### `oauth_tokens`

| Column | Type | Constraint |
|--------|------|------------|
| `participant_id` | text | unique (`oauth_tokens_pid_idx`) |
| `access_token` | text | |
| `refresh_token` | text | |
| `expires_at` | bigint | |
| `scope` | text | |
| `updated_at` | text | |

## AI gateway (available, optional)

OpenAI-compatible endpoints under the app scope; useful for intent classification / summaries:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/{app_id}/chat/completions` | Chat completion |
| POST | `/v1/{app_id}/embeddings` | Embeddings |
| GET | `/v1/{app_id}/ai/config` | Read AI config |

## MCP (alternative to REST)

Butterbase also runs as an MCP server for agent-driven schema/auth/function management. Add to `.mcp.json` or editor MCP settings:

```json
{
  "mcpServers": {
    "butterbase": {
      "url": "https://api.butterbase.ai/mcp",
      "headers": { "Authorization": "Bearer ${BUTTERBASE_API_KEY}" }
    }
  }
}
```

## Reunion mapping

| Concern | Butterbase surface |
|---------|--------------------|
| Participant identity | `participants` table (`phone` unique) |
| Google linkage | `participants.google_email` |
| OAuth token storage | `oauth_tokens` (keyed by `participant_id`) |
| Intent trigger | `intent_events` — XTrace upserts; RocketRide listens via realtime INSERT |
| Trip / poll / vote state | `trips`, `polls`, `poll_votes`, `chat_groups`, `trip_participants` (applied on startup via `src/butterbase/schema.ts`) |
| Poll creation ingress | RocketRide maps `IntentEvent` → `IntentClassificationResult`; Butterbase returns `CreateAvailabilityPollRequest` to Photon |
| Poll-flow orchestration | RocketRide reads Butterbase state for completion/roster; `ButterbaseStore` when `BUTTERBASE_*` env vars are set; in-memory fallback in dev stub |
| Programmatic access | Service key (`bb_sk_`) as Bearer token |

### Poll-flow tables (RocketRide)

Created by `POST /schema/apply` on service startup when Butterbase credentials are configured:

| Table | Purpose |
|-------|---------|
| `trips` | One per iMessage chat; stores extracted destination + timeframe |
| `polls` | Availability poll records; `status` is `open` until closed (`all_voted` or `timeout`) |
| `poll_votes` | First vote per `(poll_id, participant_handle)` |
| `chat_groups` | Participant snapshot per chat |
| `trip_participants` | Per-trip handle status (`pending` / `voted`) |

Poll creation flow (canonical): XTrace upserts `intent_events` → Butterbase realtime INSERT → RocketRide gates + maps → `upsertTrip` + create poll record → returns `CreateAvailabilityPollRequest` → Photon sends native iMessage poll.

Legacy path (dev/tests): Photon on-device classifier → `POST /butterbase/intent-classified`.

## Connection test (verified 2026-06-05)

```sh
# Liveness — 200
curl -s -o /dev/null -w "%{http_code}\n" https://api.butterbase.ai/health

# Authenticated schema read — 200
curl -s -H "Authorization: Bearer $BUTTERBASE_API_KEY" \
  "https://api.butterbase.ai/v1/$BUTTERBASE_APP_ID/schema"
```

Results: `/health` → 200, `/apps` → 200 (returns the `reunion` app), schema read → 200 (two tables).

## References

- Introduction: https://docs.butterbase.ai/getting-started/introduction/
- REST API: https://docs.butterbase.ai/sdks-and-tools/rest-api/
- AI API: https://docs.butterbase.ai/api-reference/ai-api/
- MCP setup: https://docs.butterbase.ai/getting-started/mcp-setup/
