# Integration Contract: User Roster → Calendar Availability

**Status:** Draft (seams resolved for v1)  
**Date:** 2026-06-05  
**Upstream:** RocketRide (Photon iMessage flow → `UserRoster`)  
**Downstream:** Calendar component (`POST /api/availability` → `common_free`)

## Purpose

Define the explicit transform between RocketRide's terminal `UserRoster` artifact and the calendar component's availability API. RocketRide owns the transform; the calendar component never ingests Photon events or raw `UserRoster` shape over the wire.

**Related:** `docs/contracts/intent-to-poll-integration.md` (upstream), `INTERFACE.md` (calendar I/O summary).

## Ownership

| Concern | Owner |
|---------|-------|
| Poll votes → `UserRoster` | RocketRide (`src/rocketride/roster.ts`) |
| Fuzzy `timeframe` → `{ start, end }` | RocketRide |
| Poll filter (`yes` / `no`) → phone list | RocketRide |
| `phone_number` → `phone` field rename | RocketRide |
| E.164 canonicalization before POST | RocketRide (belt); calendar may add defense |
| `POST /api/availability` | Calendar component |
| Google OAuth + `connect_url` construction | Calendar component |
| Forwarding `connect_url` to iMessage | RocketRide (via Photon) |

## Trigger

After poll completion, RocketRide emits `UserRoster` (internal artifact). RocketRide then:

1. Normalizes the trip `timeframe` to a date window.
2. Filters roster users by poll-availability inclusion rule (below).
3. Maps to the calendar request body.
4. `POST`s to the calendar API with `x-internal-key`.
5. Forwards any per-participant `connect_url` values back into the group chat.

The calendar component's **only** entry point is `POST /api/availability`. It does not subscribe to Photon or read `UserRoster` directly.

## Transform: `UserRoster` → calendar request

RocketRide MUST NOT POST a literal `UserRoster`. It MUST send the calendar input shape below.

### Inclusion rule (poll availability → calendar participants)

v1 rule — **include `yes` only, exclude `no`:**

```
participants = roster.users
  .filter(u => u.availability === "yes")
  .map(u => ({ phone: u.phone_number }))
```

| Poll vote (`availability`) | Sent to calendar? | Rationale |
|----------------------------|-------------------|-----------|
| `yes` | Yes | Committed interest; check real dates |
| `no` | No | Not planning to attend |

Non-voters (absent from `users`) are never sent. `UserRoster.complete` does not change the inclusion rule — partial rosters send whoever voted and passed the filter.

`name` from `UserRoster` is dropped at this boundary (harmless for freebusy).

### Phone canonicalization (E.164)

RocketRide normalizes every phone via `normalizeE164()` in `src/rocketride/roster.ts` **before** building the calendar request:

| Input handle | Canonical `phone` sent to calendar |
|--------------|-------------------------------------|
| `+1 (415) 555-1234` | `+14155551234` |
| `4155551234` (10 digits) | `+14155551234` |
| `14155551234` (11 digits, leading 1) | `+14155551234` |
| `someone@me.com` (email iMessage handle) | `someone@me.com` (unchanged, lowercase) |

**Contract:** numeric handles are always `+`-prefixed E.164. RocketRide never sends bare 10- or 11-digit strings without `+`.

Calendar component recommendation: add matching normalization on ingest as belt-and-suspenders (`lib/storage.ts` exact-match lookup).

### Email-style iMessage handles

Some group members use Apple ID email handles instead of phone numbers. These appear as `phone_number` / `phone` with an `@` and are valid participant keys.

Expected behavior (not a bug):

1. First `POST /api/availability` → `resolved: false`, `needs_connect_link: true`, `connect_url` returned.
2. User completes Google OAuth once; calendar stores tokens keyed to that handle.
3. Subsequent trips with the same handle → `resolved: true`, silent (no link).

Email handles will never have pre-existing Google tokens from a phone-based OAuth path.

### Timeframe → window

RocketRide reads `timeframe` from Butterbase `Trip` (originally `IntentClassificationResult.extracted.timeframe`). The calendar component does **not** parse fuzzy strings.

RocketRide MUST normalize to inclusive day bounds before calling the calendar:

```json
"window": { "start": "2026-07-01", "end": "2026-07-31" }
```

v1 normalization (demo-tolerant):

| Fuzzy `timeframe` | Normalized window |
|-------------------|-------------------|
| Month name (`july`, `august`, …) | First day → last day of that month in the current or next calendar year (nearest future) |
| `next month` | First day → last day of next calendar month |
| `weekend` | Next Saturday 00:00 → next Sunday 23:59 (as dates) |
| `null` or unrecognized | Default demo window: today + 14 days → today + 28 days |

If normalization fails entirely, RocketRide MUST NOT call the calendar API; log `calendar.window_unresolved` and surface a chat message asking the group to specify dates.

### Request body (wire format)

```http
POST /api/availability
Content-Type: application/json
x-internal-key: <INTERNAL_API_KEY>
```

```json
{
  "trip_id": "uuid-from-roster.trip_id",
  "window": { "start": "2026-07-01", "end": "2026-07-31" },
  "participants": [
    { "phone": "+14155551234" },
    { "phone": "+14155559876" }
  ]
}
```

Field mapping:

| Calendar field | Source |
|----------------|--------|
| `trip_id` | `UserRoster.trip_id` |
| `window.start` / `window.end` | RocketRide normalization of `Trip.timeframe` |
| `participants[].phone` | `UserRoster.users[].phone_number` after inclusion filter |

## Response: calendar → RocketRide

Calendar returns the shape defined in `INTERFACE.md`. RocketRide consumes:

| Field | RocketRide action |
|-------|-------------------|
| `common_free` | Persist to Butterbase / XTrace; propose dates in chat |
| `participants[].needs_connect_link` + `connect_url` | Forward link to that participant via Photon iMessage |
| `participants[].resolved: false` | Do not block trip (v1); see below |

### Unresolved participants — v1 decision (resolved)

**Unresolved participants do NOT block the trip.**

- `common_free` is computed over **resolved** participants only (calendar's current behavior).
- RocketRide MAY emit `common_free` and propose dates even when some participants are unresolved.
- RocketRide sends `connect_url` via iMessage for each unresolved participant.
- Chat copy SHOULD note that proposed dates reflect connected calendars only.

Blocking behavior (require 100% resolution before proposing dates) is deferred to v2.

## Authentication

| Variable | Set on | Purpose |
|----------|--------|---------|
| `CALENDAR_API_URL` | RocketRide | Base URL for calendar app (e.g. `https://reunion.example.com`) |
| `INTERNAL_API_KEY` | Both RocketRide and calendar | Shared secret; calendar validates `x-internal-key` header |

RocketRide sends:

```
x-internal-key: ${INTERNAL_API_KEY}
```

Values MUST match across both services' environment. For local dev, both `.env` files use the same key (generate once, share out-of-band).

## Error contract

| Condition | Owner | Behavior |
|-----------|-------|----------|
| Empty `participants` after filter | RocketRide | Skip calendar call; no one is "in" |
| `400` from calendar (malformed body) | RocketRide | Log `calendar.request_invalid`; fix transform |
| `401` from calendar (bad key) | RocketRide | Log `calendar.auth_failed`; check env |
| `5xx` from calendar | RocketRide | Retry once, then surface to chat |
| All participants unresolved | Calendar | `common_free: []`; RocketRide sends all connect links |

## Observability

RocketRide logs after roster emission:

1. `calendar.requested` — `trip_id`, `window`, participant count
2. `calendar.responded` — resolved count, `common_free` span count
3. `calendar.connect_link.forwarded` — per unresolved handle

## Resolved decisions (v1)

1. **Wire format** — calendar receives transformed body, not literal `UserRoster`.
2. **Field rename** — `phone_number` → `phone` is RocketRide's job.
3. **E.164** — RocketRide always sends `+`-prefixed E.164 for numeric handles.
4. **`yes`-only filter** — only `availability === "yes"` phones sent to calendar.
5. **Unresolved blocking** — does not block; exclude from `common_free` intersection only.
6. **Auth** — `x-internal-key: $INTERNAL_API_KEY` on every request.
7. **Email handles** — valid keys; always unresolved until OAuth; silent thereafter.

## Open decisions (v2)

1. Plaintext availability fallback in calendar request body.
2. Blocking semantics if zero participants resolve.

## Related docs

- `INTERFACE.md`
- `docs/contracts/intent-to-poll-integration.md`
- `ADR/ADR-003` — v1 calendar contract is availability only
- `src/rocketride/roster.ts` — `normalizeE164`, roster build
