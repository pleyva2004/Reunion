# ADR-010: Use iMessage as the primary surface (refines prior decision)

- **Status:** Accepted
- **Date:** 2026-06-05
- **Updated:** 2026-06-05 — switched primary surface from WhatsApp to iMessage; WhatsApp dropped.
- **Reconciliation:** REFINES
- **Source:** Today : release; Agentic Hackathon; Group Travel Planning Agent; prior surface ADR
- **Notion URL:** https://app.notion.com/p/ba4bcbdb94034c09a470f73b8563b60c

## Context & Options

The team considered iMessage, WhatsApp, Discord, and standalone app options. iMessage was chosen as the single target surface, integrated via Photon (Spectrum + advanced-imessage-kit).

## Decision

Use iMessage group chat as the primary (and only) product surface for the hackathon prototype.

## Consequences

The demo runs where the user problem already exists, while richer standalone UX is deferred. WhatsApp is no longer a target surface.
