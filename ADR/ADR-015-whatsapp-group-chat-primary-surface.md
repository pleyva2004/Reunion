# ADR-015: Use iMessage group chat as the primary product surface

- **Status:** Accepted
- **Date:** 2026-06-05
- **Updated:** 2026-06-05 — switched primary surface from WhatsApp to iMessage; WhatsApp dropped.
- **Reconciliation:** NEW
- **Source:** @Today : release; Agentic Hackathon; Group Travel Planning Agent
- **Notion URL:** https://app.notion.com/p/aba4a71bcee043fc86a733ca11ecdb9e

## Context & Options

The problem happens in group chat. Among iMessage, WhatsApp, Discord, and standalone app options, iMessage was chosen as the single target surface via Photon (Spectrum inbound + advanced-imessage-kit for native polls).

## Decision

Build the prototype as an iMessage-only group travel planning agent via Photon / Spectrum, not as a WhatsApp, standalone app, or Discord bot.

## Consequences

Messaging integration becomes core while broad UI scope is avoided. The product is scoped to iMessage only; WhatsApp is no longer a target surface.
