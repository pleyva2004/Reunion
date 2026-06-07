# Group Travel Planning Agent (Reunion)

Reunion is a messaging-native group travel planning agent built for the Agentic AI SF Hackathon. It detects travel intent in group chat, remembers constraints and preferences, and turns casual conversation into concrete coordination steps.

## Project objective

Build an iMessage-first prototype that proves one full loop:

1. Group travel intent appears in chat.
2. The system extracts planning entities and constraints.
3. Durable memory and app state are updated.
4. The agent posts a useful next coordination action back in chat.

## Why this exists

Group travel planning usually fails because coordination state is fragmented across messages, people, and tools. Reunion treats this as a coordination-memory problem, not just a search problem.

## Core architecture

- **Messaging interface:** Photon / Spectrum (iMessage-only)
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
