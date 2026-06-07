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

Two tables exist (migration `create_participants_and_oauth_tokens`, applied 2026-06-05).

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
| Programmatic access | Service key (`bb_sk_`) as Bearer token |

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
