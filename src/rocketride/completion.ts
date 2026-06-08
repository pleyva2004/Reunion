import type { PollCompletedReason } from "../contracts/types.js";

/**
 * Poll completion triggers (v1):
 *  - all known participants have voted → close immediately and emit roster, or
 *  - a 24h timeout elapses → close and emit partial roster.
 *
 * Individual votes are persisted as they arrive; the roster is emitted once on close.
 */

interface TrackedPoll {
  participants: Set<string>;
  voted: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  done: boolean;
  onComplete: (reason: PollCompletedReason) => void;
}

export class CompletionTracker {
  private readonly polls = new Map<string, TrackedPoll>();

  constructor(private readonly timeoutMs: number) {}

  register(
    pollId: string,
    participants: string[],
    onComplete: (reason: PollCompletedReason) => void,
  ): void {
    const tracked: TrackedPoll = {
      participants: new Set(participants),
      voted: new Set(),
      timer: null,
      done: false,
      onComplete,
    };
    if (Number.isFinite(this.timeoutMs) && this.timeoutMs > 0) {
      tracked.timer = setTimeout(() => this.fire(pollId, "timeout"), this.timeoutMs);
      tracked.timer.unref?.();
    }
    this.polls.set(pollId, tracked);
  }

  recordVote(pollId: string, handle: string): void {
    const tracked = this.polls.get(pollId);
    if (!tracked || tracked.done) return;
    tracked.voted.add(handle);
    const everyoneVoted =
      tracked.participants.size > 0 &&
      [...tracked.participants].every((p) => tracked.voted.has(p));
    if (everyoneVoted) this.fire(pollId, "all_voted");
  }

  private fire(pollId: string, reason: PollCompletedReason): void {
    const tracked = this.polls.get(pollId);
    if (!tracked || tracked.done) return;
    tracked.done = true;
    if (tracked.timer) clearTimeout(tracked.timer);
    tracked.onComplete(reason);
  }

  isDone(pollId: string): boolean {
    return this.polls.get(pollId)?.done ?? false;
  }

  clear(): void {
    for (const tracked of this.polls.values()) {
      if (tracked.timer) clearTimeout(tracked.timer);
    }
    this.polls.clear();
  }
}
