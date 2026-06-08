import pino from "pino";

/**
 * RocketRide pipeline observability.
 *
 * The contract requires these stages to be log-visible (for demo/judges):
 *   intent.classified, poll.requested, poll.sent,
 *   poll.vote.received, vote.ignored, roster.emitted, knowledge.written
 *
 * See docs/contracts/intent-to-poll-integration.md (Observability).
 */

export const STAGES = {
  INTENT_UPSERTED: "intent.upserted",
  INTENT_RECEIVED: "intent.received",
  INTENT_MAPPED: "intent.mapped",
  INTENT_GATE_FAILED: "intent.gate_failed",
  INTENT_CLASSIFIED: "intent.classified",
  INTENT_FORWARDED: "intent.forwarded",
  POLL_REQUESTED: "poll.requested",
  POLL_SENT: "poll.sent",
  POLL_VOTE_RECEIVED: "poll.vote.received",
  VOTE_IGNORED: "vote.ignored",
  ROSTER_EMITTED: "roster.emitted",
  KNOWLEDGE_WRITTEN: "knowledge.written",
} as const;

export type Stage = (typeof STAGES)[keyof typeof STAGES];

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

/** Emit a named pipeline stage with structured context. */
export function stage(name: Stage, data: Record<string, unknown> = {}): void {
  logger.info({ stage: name, ...data }, name);
}

/** Emit an error-contract event. */
export function stageError(
  code: string,
  data: Record<string, unknown> = {},
): void {
  logger.warn({ error_code: code, ...data }, code);
}
