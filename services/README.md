# services/

Standalone sibling apps that interoperate with the orchestration **spine** at the
repo root across a defined boundary. Each keeps its own `package.json` and build —
they are deliberately *not* folded into the root package, because they use
different runtimes/tooling and run as separate processes.

| Path | Owner | What it is | How it connects to the spine |
|---|---|---|---|
| `intent-gate/` | Pablo | On-device travel-intent gate (TS + Apple Swift `sidecar/`, Variant B: Apple Foundation Models). Runs on the Mac, reads `chat.db` at the `imessage-kit` layer to see every message including from-me. | Upstream of the pipeline: it decides "is this worth waking the pipeline?" The spine's `src/gate/` is the heuristic v0 of this same seam; this service is the real on-device implementation. |
| `calendar/` | Kevin | Next.js app: Google OAuth + availability engine. Exposes `POST /api/trip-availability`. Own pnpm workspace. | The spine calls it over HTTP via `src/planning/when/calendarClient.ts` (`CalendarClient`). Falls back to the in-process interval engine when the endpoint is absent. |

The root package (the spine) is the integration backbone: RocketRide pipeline →
XTrace memory → Butterbase state → next-move, verified green (`npm run typecheck`,
`npm run test`, `npm run demo`). See the root `README.md` and `CLAUDE.md`.

## Building a service

Each service builds independently from its own directory, e.g.:

```bash
cd services/calendar && pnpm install && pnpm dev        # Kevin's availability service
cd services/intent-gate && npm install && npm run dev   # Pablo's gate (Mac + Swift sidecar)
```

These were vendored onto the `main-verify` integration branch from
`feat/calendar-component` and `feature/intent-classification` respectively; their
private/native deps are not installed in CI, so only the root spine is verified here.
