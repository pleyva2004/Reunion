# ADR-007: Filter travel intent on-device (CoreML/Swift) before cloud orchestration

- **Status:** Accepted
- **Date:** 2026-06-05
- **Updated:** 2026-06-05 — committed to an on-device CoreML/Swift classifier running before the poll integration.
- **Reconciliation:** NEW
- **Source:** Today : release; Hackathon Planning Discussion
- **Notion URL:** https://app.notion.com/p/b024765b2c3e46cbb72c58e3d0e575d8

## Context & Options

Sending every group message to a cloud model is noisy and privacy-hostile. Keyword-only triggers are brittle. The iMessage connection runs on a macOS device, so an on-device model can classify before anything leaves the device.

## Decision

Run the travel-intent classifier **on-device using CoreML / Swift**, on the macOS host of the iMessage connection, before invoking RocketRide cloud orchestration and the poll integration. Raw message text stays on the device; only a gate-passing `IntentClassificationResult` crosses the device→cloud boundary.

## Consequences

Privacy and noise handling improve and raw text never leaves the device on below-threshold messages, but classifier implementation quality (CoreML model accuracy, Swift integration) becomes a key risk. The intent module is a prerequisite that must ship before the availability-poll integration.
