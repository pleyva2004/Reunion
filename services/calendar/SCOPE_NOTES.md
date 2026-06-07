# SCOPE_NOTES.md — V1 vs V2

Records what's in V1, what's deferred, and the dependencies — so nobody builds V1 assuming
V2 capabilities exist.

## V1 (build this)

- Google Calendar OAuth (Testing mode, `calendar.freebusy` scope).
- `/connect` link builder + `/oauth/callback` token exchange + token storage.
- Returning-user skip (valid/refreshable token → no link).
- Availability engine: per-participant `busy` + `free`, plus `common_free` intersection.
- Plain-text availability fallback.
- Output: the JSON in INTERFACE.md.

V1 uses **busy/free data only**. With `calendar.freebusy`, Google returns anonymous busy
intervals — **no event titles, descriptions, attendees, or locations**. V1 code must not
assume any event content is available.

## V2 (deferred) — Movability classification

**Goal:** when a participant is busy, judge whether that commitment could be moved. E.g. a
"lunch with a friend" is movable; a "surgery" is not. This lets the agent propose windows
that are technically busy but practically free.

**Hard dependency:** this requires reading **event contents**, which `calendar.freebusy`
does NOT provide. It needs an upgrade to **`calendar.readonly`** (or `calendar.events.readonly`),
i.e. the "see events on all your calendars" scope.

**Tradeoffs that come with that upgrade:**
- **Consent UX:** the screen changes from "see your availability" to "see events on all
  your calendars" — more invasive-sounding, higher drop-off.
- **Privacy:** we'd be reading potentially sensitive event titles (medical, therapy,
  personal). Needs a deliberate privacy stance — what we read, store, log, and for how long.
- **Classification is fuzzy:** deciding movable-vs-not from a title is a heuristic/LLM step
  and will be wrong sometimes ("Dinner w/ Mom", "Call", "Block"). Needs a confidence notion
  and probably a human confirm ("we think the 14th works if you can move 'lunch' — ok?").
- **Verification:** `calendar.readonly` is still a *sensitive* (not restricted) scope, so no
  paid audit — but for any public launch it widens what review covers. Fine in Testing mode.

**Suggested V2 output extension (not built in V1):** add to each busy block an optional
`movability: { score: 0..1, label: "movable" | "fixed" | "unknown", reason: string }`,
derived from the event title. Keep it additive so V1 consumers don't break.

**Recommendation:** ship V1 on freebusy. Treat V2 as a separate spike with its own scope
upgrade, privacy review, and classifier — don't entangle it with the V1 availability path.
