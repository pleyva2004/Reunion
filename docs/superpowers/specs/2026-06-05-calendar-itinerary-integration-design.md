# Calendar HTTP integration + itinerary flow — design

**Date:** 2026-06-05
**Owner:** Jossue (RocketRide pipeline + XTrace memory)
**Trigger:** Kevin's handoff — the calendar component shipped as a deployed HTTP
endpoint (`POST /api/trip-availability`), replacing the in-process interval engine.

## Goal

Conform the "what" pipeline to Kevin's shipped contract and change the final
artifact from a date poll to a rendered, plain-text **itinerary** sent into the
iMessage chat.

## Decisions (locked)

1. **Final move:** auto-pick the best window from `common_free`, then render an
   itinerary. No date poll.
2. **Block on unresolved:** proceed with whoever resolved; pending participants
   still get a connect link surfaced for Photon to DM.
3. **Itinerary generation:** RocketRide LLM pipeline with a deterministic template
   fallback (mirrors the extraction degrade pattern).
4. **Timeframe:** write an ISO range (`2026-07-10..2026-07-20`) to `trips.timeframe`
   when extractable, else the fuzzy string.

## New flow

```
extract → upsertTrip (ISO timeframe → trips.timeframe, status "forming")
        → status "scheduling"
        → availability resolver:
              real → POST /api/trip-availability { trip_id }
                     → common_free ranges + per-participant resolved|needs_connect_link
                     → pickWindow(common_free ∩ timeframe) → CandidateWeekend[]
              stub → in-process interval engine over the mock calendar
        → no windows → nextStep "gather-availability" (surface pendingConnects)
        → windows → auto-pick candidates[0]
                  → gather XTrace facts (diet/budget) + cultureBrief
                  → generateItinerary (RocketRide pipe + template fallback)
                  → write trips.current_summary = itinerary, status "planned"
                  → write XTrace: per-participant availabilityWindow; group plannedTrip
        → nextAction → plain-text itinerary OutgoingMove
```

## New modules

- `src/planning/when/calendarClient.ts` — typed client for Kevin's endpoint.
  Injected `fetch` (testable), sends `x-internal-key`, idempotent. Tolerant parse:
  `common_free` accepts epoch-ms or ISO; normalized to epoch ms. Returns
  `{ commonFree: Range[], participants: [{handle, status, connectUrl?}] }`.
- `src/planning/when/pickWindow.ts` — pure: `commonFree ∩ timeframe → CandidateWeekend[]`
  best-first. Reuses the `CandidateWeekend` contract so the plan seam shape is stable.
- `src/planning/when/availabilityResolver.ts` — `AvailabilityResolver` +
  `AvailabilityResult { candidates, pendingConnects }`; `resolveAvailability(cfg, stub)`
  gate (real calendar client when configured + `USE_STUBS=false`, else stub).
- `src/planning/what/itinerary.ts` — `generateItinerary({destination, window, facts})
  → string`. RocketRide pipe + deterministic template fallback (`withTimeout` + degrade,
  copied from the extractor). Coercion `coerceItineraryText(raw)` unwraps the
  `answers`/`result` envelope.
- `src/planning/what/timeframe.ts` — `normalizeTimeframe(raw, now?)` (→ ISO range)
  and `parseTimeframe(tf)` (→ `{start,end}` for pickWindow).
- `pipelines/generate-itinerary.pipe` — sibling to the extraction pipe.

## Changed files

- `src/contracts/index.ts` — add `PendingConnect { handle, connectUrl }` (shared with
  the channel/Photon layer).
- `src/config.ts` — add `calendar { baseUrl, internalKey }` + itinerary pipe path.
- `src/planning/what/tripState.ts` — normalize timeframe to ISO before persisting.
- `src/pipeline/plan.ts` — inject `availability` (new resolver shape) + `generateItinerary`;
  proceed-with-resolved; status `forming → scheduling → planned`; add `itinerary`,
  `pendingConnects`, `chosenWindow` to `PlanResult`; `nextStep` gains `"itinerary"`.
- `src/pipeline/nextAction.ts` — `"itinerary"` → plain-text move (no Markdown, no poll).
- `src/demo.ts` — show the new flow on stubs; log pendingConnects; keep the memory beat.
- `.env.example` — `CALENDAR_BASE_URL`, `CALENDAR_INTERNAL_KEY`,
  `ROCKETRIDE_ITINERARY_PIPELINE`.

## Kept / untouched

- In-process interval engine (`availability.ts`/`intervals.ts`) stays as the
  `USE_STUBS` fallback.
- `participants` / `oauth_tokens` tables are Kevin's; not touched.
- `chat_guid`↔`groupId` mapping is the channel seam (Ethan), not here.

## Tests

calendarClient parse (resolved/pending/idempotent, epoch+ISO) · pickWindow (∩ timeframe,
best-first, empty) · timeframe normalize/parse · itinerary template fallback + RocketRide
coercion · plan wiring (proceed-with-resolved, status transitions, pendingConnects,
itinerary written) · nextAction plain-text output. Keep the suite green.

## Open items (flag, not block)

- Exact `common_free` JSON units (epoch ms vs ISO) — tolerant parse now; confirm with
  Kevin (a `calendar-probe.ts` like `rocketride-probe.ts` once `CALENDAR_INTERNAL_KEY`
  is shared).
- `pendingConnects` → Photon DM is a surfaced field; the actual `send` is Ethan's.
