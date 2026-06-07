# INTERFACE.md — The Contract

This is the seam between the calendar component and the rest of the system (RocketRide /
XTrace, owned by teammates). Freeze this early; integration day depends on it.

## The four handshakes to confirm with teammates

1. **What triggers us & what we receive** — defined below (Input).
2. **What we hand back & how** — defined below (Output). Decide: do we WRITE the JSON to a
   shared location (Butterbase / a file) or RETURN it from a call? Default assumption:
   we produce the JSON object; transport TBD with the RocketRide owner.
3. **Who builds connect links** — we expose the link builder (below). They call it, or we
   send links ourselves. Default: we expose `buildConnectLink(tripId, participantId)`.
4. **Who populates participant identity** — we need a `phone → participant` row to exist
   (or be created) before resolution. Confirm who creates participant rows and when.

## Input

We are handed a list of participant **phone numbers** and a candidate date window:

```json
{
  "trip_id": "abc-123",
  "window": { "start": "2026-07-10", "end": "2026-07-20" },
  "participants": [
    { "phone": "+15551234567" },
    { "phone": "+15559876543" }
  ]
}
```

- Phone is the ONLY identifier provided. Google uses email, so each phone must resolve via
  a stored `phone → participant → google_email → tokens` mapping (see Resolution below).
- A participant may instead be supplied with plain-text availability (fallback). Shape TBD
  with teammates; we accept and tag it `source: "plaintext"`.

## Output

A single JSON object. `busy` is the raw freebusy result; `free` is window-minus-busy;
`common_free` is the intersection across all resolved participants.

```json
{
  "trip_id": "abc-123",
  "window": { "start": "2026-07-10", "end": "2026-07-20" },
  "participants": [
    {
      "phone": "+15551234567",
      "resolved": true,
      "source": "freebusy",
      "busy": [
        { "start": "2026-07-12T18:00:00Z", "end": "2026-07-12T19:00:00Z" }
      ],
      "free": [
        { "start": "2026-07-10T00:00:00Z", "end": "2026-07-12T18:00:00Z" },
        { "start": "2026-07-12T19:00:00Z", "end": "2026-07-20T00:00:00Z" }
      ]
    },
    {
      "phone": "+15559876543",
      "resolved": false,
      "source": null,
      "needs_connect_link": true,
      "connect_url": "https://<app>/connect?s=<signed-token>",
      "busy": [],
      "free": []
    }
  ],
  "common_free": [
    { "start": "2026-07-14T00:00:00Z", "end": "2026-07-16T00:00:00Z" }
  ]
}
```

Field notes:
- `resolved` — true if we obtained availability (via freebusy OR plaintext).
- `source` — `"freebusy" | "plaintext" | null`.
- `needs_connect_link` / `connect_url` — present when a participant is unresolved and needs
  to authorize; teammates' layer sends that link via iMessage.
- All timestamps ISO 8601 UTC. `window` dates are inclusive day bounds.
- `common_free` is computed over `resolved` participants only. (Decide with teammates
  whether an unresolved participant blocks the trip or is simply excluded.)

## Resolution logic (per incoming phone)

```
lookup token by phone (via participant mapping):
  • valid token            → freebusy → resolved
  • expired, refresh OK     → freebusy → resolved
  • expired, refresh fails  → unresolved, emit connect_url (token revoked)
  • no token / unknown phone→ unresolved, emit connect_url
  • plaintext supplied      → parse → resolved (source = plaintext)
```

Returning users with a stored token produce NO link and NO user interaction — that's the
"second trip is silent" behavior.

## Connect link builder

A function we own, inside the OAuth web app:

```
buildConnectLink(tripId, participantId) -> string
  // signs a state token { tripId, participantId, exp } with STATE_SIGNING_KEY
  // returns https://<app>/connect?s=<signed-token>
```

`/connect?s=…` decodes the token, builds the Google consent URL (scope = calendar.freebusy,
access_type=offline, prompt=consent, state echoes the signed token), and redirects.
`/oauth/callback?code=…&state=…` re-verifies the token, exchanges the code, stores tokens
keyed to participantId, marks the participant resolved.
