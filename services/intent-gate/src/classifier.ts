import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type Verdict = {
  isTravelIntent: boolean;
  confidence: number;
  location: string;
};

const SIDECAR_BIN = join(
  process.cwd(),
  "sidecar",
  ".build",
  "release",
  "intent-sidecar",
);

type Pending = { resolve: (v: Verdict) => void; reject: (e: Error) => void };

let proc: ChildProcess | undefined;
const pending: Pending[] = [];

/**
 * Spawn the Swift sidecar and resolve once it reports the on-device model is
 * available. Rejects if the model is unavailable (e.g. Apple Intelligence off).
 */
export function startClassifier(): Promise<void> {
  if (!existsSync(SIDECAR_BIN)) {
    return Promise.reject(
      new Error(`sidecar binary not found at ${SIDECAR_BIN} — run \`npm run sidecar:build\``),
    );
  }

  proc = spawn(SIDECAR_BIN, [], { stdio: ["pipe", "pipe", "pipe"] });

  return new Promise<void>((resolveReady, rejectReady) => {
    let ready = false;
    const rl = createInterface({ input: proc!.stdout! });

    rl.on("line", (line) => {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }

      if (obj.ready === true) {
        ready = true;
        resolveReady();
        return;
      }

      const next = pending.shift();
      if (!next) {
        // Unsolicited line before any request → a startup error.
        if (typeof obj.error === "string" && !ready) rejectReady(new Error(obj.error));
        return;
      }

      if (typeof obj.error === "string") {
        next.reject(new Error(obj.error));
        return;
      }

      next.resolve({
        isTravelIntent: obj.isTravelIntent === true,
        confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
        location: typeof obj.location === "string" ? obj.location : "",
      });
    });

    proc!.on("exit", (code) => {
      const err = new Error(`sidecar exited (code ${code ?? "null"})`);
      if (!ready) rejectReady(err);
      while (pending.length) pending.shift()!.reject(err);
    });
  });
}

/** Classify a conversation window. FIFO-paired with sidecar responses. */
export function classify(window: string): Promise<Verdict> {
  return new Promise<Verdict>((resolve, reject) => {
    if (!proc || !proc.stdin) {
      reject(new Error("classifier not started"));
      return;
    }
    pending.push({ resolve, reject });
    proc.stdin.write(JSON.stringify({ window }) + "\n");
  });
}
