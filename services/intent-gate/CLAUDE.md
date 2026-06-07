# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Reunion** is a **WhatsApp-first group travel planning agent**. It lives inside a
friend group's existing messaging thread, watches for travel intent, remembers
each person's and the group's constraints, and turns vague group-chat desire into
an executable trip plan (dates, flights, lodging, food) — without anyone having
to open a separate app, build a spreadsheet, or become the unpaid trip PM.

This is a **hackathon project**. Eligibility requires all four sponsor tools below
to participate in the core loop, and the demo runs *inside the chat surface*.

## The problem (why this exists)

Friends in their 20s live in different cities and coordinate travel in messy group
chats. Planning state is scattered across chat history, calendars, dietary prefs,
budgets, and social momentum. Today:

1. Travel intent is detected too late or not at all.
2. Good ideas get buried in chat before becoming plans.
3. Constraints live in people's heads (dates, budget, diet, preferred airports, lodging, work conflicts).
4. Coordination requires one person to become the unpaid trip PM.
5. Existing travel tools assume an individual search session, not a living group conversation.

## Core loop

```
iMessage group message
  → on-device CoreML intent filter (runs on the Mac bridge, before the pipeline)
  → RocketRide pipeline: intent detection → entity extraction → path routing
                         → memory-aware planning → next-action generation
  → XTrace: read/write durable person + group facts ("what is true now?")
  → Butterbase: persist trip state (users, groups, trips, polls, options, plan)
  → Photon/Spectrum: send the next coordination move back into the same chat
```

There are **three operating paths** the router chooses between:
- **destination-known** — they know where, resolve when/who/how.
- **time-known** — they know when, resolve where/who/how.
- **open-ended** — nothing fixed; surface options and build momentum.

## Sponsor tools and their roles

Each tool owns a distinct layer. Do not blur these boundaries.

| Tool | Role | Responsibility |
|---|---|---|
| **Photon / Spectrum** | Messaging interface | Receive **iMessage** group messages (identify group, sender, context); send the agent's next move back into the same chat. iMessage-first; Telegram is a fallback via the same abstraction. |
| **RocketRide** | Agentic workflow | The core pipeline: intent detection, entity extraction, path routing, memory-aware planning, next-action generation. Keep it **visible** enough for judges. |
| **XTrace** | Durable memory | Structured facts with timestamps, sources, confidence, and belief revision. New facts supersede old ones — answers "what is true *now*?" rather than retrieving similar old messages. |
| **Butterbase** | Backend state | App state + primitives: users, groups, trips, participants, messages, polls, options, plan artifacts. Also provides the AI model gateway. |

### Memory vs. state — keep these separate
- **XTrace (memory)** = evolving *beliefs* about people/groups (availability, diet,
  budget posture, airport prefs, destination interests, prior decisions,
  contradictions). It revises beliefs over time.
- **Butterbase (state)** = the *system of record* for application entities (a trip
  row, a poll, the current plan). It does not reason about belief revision.

## Messaging channel (decided: iMessage via Photon/Spectrum)

**iMessage-first, via `spectrum-ts`** (`spectrum-ts/providers/imessage`). Chosen
because the group is all on iPhone, it's the native surface, and an on-device
intent classifier is possible. There is **no middleware/hook API** — Spectrum
exposes an **async iterator** and hands you full control of the loop body, so the
"pre-delivery intent gate" is simply the first lines inside the loop:

```ts
for await (const [space, message] of app.messages) {
  if (message.platform !== "iMessage") continue;
  // ── on-device intent gate runs HERE; `continue` skips non-travel chatter ──
  await space.responding(async () => { await message.reply(/* next move */); });
}
```

### Connection mode — DECIDED: Local mode

Spectrum has three modes; they trade on-device privacy against rich output.

| | **Local** (`config({local:true})`) | Cloud (default) | Dedicated (own relay) |
|---|---|---|---|
| Inbound path | reads `chat.db`, **no network** | Spectrum Cloud gRPC | your own gRPC relay |
| On-device privacy | ✅ strongest | ❌ transits cloud | ⚠️ your infra, networked |
| Mini-app cards / effects / group creation / reactions | ❌ **throws** | ✅ | ✅ |
| Plain text + attachments + URL-unfurl card | ✅ | ✅ | ✅ |
| Join/read/send-text in an existing group | ✅ | ✅ | ✅ |
| Setup cost | low (a Mac) | low (projectId/secret) | high (run a relay) |

**Decision: Local mode.** Rationale tied to the PRD:
- The cloud-only flourishes (effects, native bubbles) **clash with the product's
  restrained personality** (PRD §23 "the friend who remembers everything without
  dominating"; §18 "keep responses short"). So local mode's limits cost ~nothing.
- Required artifacts (date poll, summary — PRD §11) render fine as **text +
  URL-unfurl card** to a hosted Butterbase page; voting happens on that page or via
  text reply. No cloud features needed.
- **Lowest integration risk** — the PRD's #1 named risk (§20 "messaging
  integration delays", mitigated by "narrow demo path"). One Mac, no relay, no
  Apple Developer account, no cloud tokens to expire mid-demo.
- Makes **privacy-aware** (§13.4) literally true and preserves the on-device gate
  as the differentiator.

### Custom objects — two tiers

1. **URL-unfurl link preview (baseline).** Send a URL as text; iMessage unfurls it.
   Works in **all modes**, **zero Apple Developer setup**. Render polls / options /
   plan artifacts as a **hosted Butterbase page** with Open Graph metadata. This is
   the default given the Local-mode lean.
2. **`customizedMiniApp` card (rich).** caption / image / deep-link layout
   (mirrors Apple `MSMessageTemplateLayout`). Requires **cloud or dedicated mode**
   **and** a `teamId` + `extensionBundleId` (Apple Developer account + an iMessage
   extension target). Recipients without the extension see a fallback. Only pursue
   if we switch off Local mode.

### Keep the channel layer thin and platform-agnostic

The pipeline depends only on a normalized shape, never on iMessage specifics:
- inbound: `IncomingMessage { channel, groupId, senderId, text, ts }`
- outbound: `OutgoingMove { groupId, text, cardUrl?, poll?, options? }`

This keeps Telegram a one-config fallback for the demo.

### How iMessage works under the hood (`imessage-kit`)

Polls the local `chat.db` SQLite (WAL mode) read-only and sends via AppleScript;
runs on **one specific Mac** tied to an iCloud account. Implications: a few-second
poll lag is normal (fine for a planner, not realtime), and it doesn't scale —
demo-grade by design.

### Read path — `imessage-kit` watcher, NOT the Spectrum message stream

**Reunion is an ambient observer: it must check EVERY message in the group,
including ones sent from the bridge's own account.** Spectrum's `app.messages`
stream **drops self-sent messages** (it only yields *incoming* messages, with no
opt-in). So the intent gate reads one layer lower, via
`@photon-ai/imessage-kit`'s `IMessageSDK.startWatching({ onIncomingMessage,
onFromMeMessage })` — which surfaces both incoming and from-me rows, with decoded
`text` (handles the `attributedBody` blob) and `isFromMe`/`chatKind`/`participant`.

- Spectrum stays the layer for **sending** the agent's reply later (`space.send`)
  and keeps the channel abstraction; only the *read/gate* path bypasses it.
- Verified end-to-end: self-sent travel messages are now classified (e.g. "Who's
  down to go Miami?" → intent YES, location Miami).

## On-device intent classifier

A **two-stage** intent model. Don't conflate the stages:
1. **On-device gate (this section)** — a cheap binary "is this worth waking the
   pipeline?" filter at the top of the Spectrum loop. The privacy/cost layer.
2. **RocketRide classification** — the heavier signal-strength + entity extraction
   (PRD §14 step 2, FR1). Runs only on messages the gate passes.

### Runtime — DECIDED: in-process ONNX

Spectrum is TypeScript (Bun/Node); CoreML is invoked via Apple Swift frameworks —
you **cannot** load a `.mlmodel` from a TS process.

- **Decision: in-process ONNX / transformers.js** (`onnxruntime-node`). No language
  boundary, one process, still on-device (runs on the Mac).
- Rejected: a Swift+CoreML sidecar. Its only payoff is the "Neural Engine" pitch
  line — but CoreML **is not one of the four sponsor tools** (no hackathon credit,
  PRD §19) and isn't in the narrative (§23). The sidecar adds a process that can
  crash mid-demo, working against §13 "recoverable on partial failures" and §20's
  narrow path. ONNX gives identical on-device privacy with less risk.

### Build order — heuristic first, model behind the same interface

- Ship a **keyword/heuristic pre-filter** as the v0 gate so the demo "has a local
  gate" even if the model isn't trained (serves §20 "use synthetic seeded context
  if needed").
- Slot the ONNX model in behind a stable `classify(window) → isTravelIntent`
  interface once trained — no caller changes.

### Design notes

- **Input is a sliding window, not one message.** Intent emerges across turns
  ("we should travel" → "yeah" → "where tho"). Feed the last N messages.
- **Training data is the critical path.** Must hand-author/synthesize a few hundred
  labeled group-chat examples (travel-intent vs. chatter). Most-likely-skipped,
  most-likely-to-whiff item — hence the heuristic fallback above.
- **Latency is a non-issue** — inference is negligible next to the `chat.db` poll
  interval.

## Architecture principles

- **Messaging-native.** The chat is the only surface. No separate app, no spreadsheet, no required coordinator.
- **Intent filter runs locally first.** A lightweight classifier gates the RocketRide pipeline so most chatter never leaves the device/edge. Privacy-preserving by design.
- **Memory answers "what's true now."** Prefer belief-revision over similarity search. When a new fact contradicts an old one, the new one wins (via XTrace).
- **Every reply is the *next useful move.*** The agent's output is always a concrete coordination action in chat (a poll, an option set, a confirmation), not a chatbot monologue.
- **Demo clarity matters.** This is judged. Favor a legible, observable pipeline over cleverness.

## Status

Greenfield — no application code yet. Update the sections below as the codebase
takes shape (commands, project layout, conventions).

## Commands

_TBD — add build/run/test/lint commands here as they're established._

## Project layout

_TBD — document directory structure here once scaffolded._
