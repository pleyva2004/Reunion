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

- **Messaging interface:** Photon / Spectrum (iMessage-first, local mode)
- **Workflow orchestration:** RocketRide
- **Durable memory:** XTrace
- **Application backend state:** Butterbase

## Intent-gate demo (Variant B — Apple Foundation Models)

An on-device travel-intent gate: Spectrum reads iMessage locally, a Swift sidecar
classifies each message with the on-device Apple Intelligence model, and a developer
readout prints intent + extracted destination. No training data, nothing leaves the
Mac. (Variant A, a purpose-trained CoreML model, is documented in
`futureworks/variant-a-coreml-classifier.md`.)

### One-time setup

1. **Grant Full Disk Access** to the terminal app you'll run the command in
   (Terminal, iTerm, or VS Code): System Settings → Privacy & Security →
   Full Disk Access → enable your terminal, then fully quit and reopen it.
   Required to read `~/Library/Messages/chat.db`.
2. **Enable Apple Intelligence**: System Settings → Apple Intelligence & Siri.
3. Install + build: `npm install && npm run sidecar:build`

### Run

```bash
npm run dev          # reads iMessage, prints a readout per message
npm run sidecar:smoke  # offline check: pipes sample lines through the classifier
```

Send an iMessage (e.g. "we should do a trip to Lisbon in September") and watch:

```
------------------------------------------------------------
chat:       group
from:       +15551234567
message:    we should do a trip to Lisbon in September
intent:     YES
confidence: 0.90
location:   Lisbon
------------------------------------------------------------
```

### Layout

- `sidecar/` — Swift Foundation Models classifier (line-oriented JSON over stdio)
- `src/index.ts` — Spectrum local read → per-chat window → classify → readout
- `src/classifier.ts` — sidecar process wrapper

## Repository documentation

- Product requirements: `docs/PRD.md`
- Documentation overview: `docs/README.md`
- Architecture decisions: `ADR/README.md` and `ADR/ADR-*.md`

## Current status

The repository docs are synced to the Notion project page, PRD page, and ADR decision database linked from:

- [Group Travel Planning Agent (Notion)](https://www.notion.so/staffroomai/Group-Travel-Planning-Agent-870322eb3917415dae037a918e07f1e9?source=copy_link)
