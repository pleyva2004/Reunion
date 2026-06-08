import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "./spectrum-webhook.js";

const SECRET = "test-signing-secret";

function sign(rawBody: string, timestamp: string): string {
  return (
    "v0=" +
    createHmac("sha256", SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex")
  );
}

describe("verifySignature", () => {
  const body = JSON.stringify({ event: "messages" });
  const now = String(Math.floor(Date.now() / 1000));

  it("accepts a valid signature within tolerance", () => {
    expect(verifySignature(body, now, sign(body, now), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(body + "x", now, sign(body, now), SECRET)).toBe(false);
  });

  it("rejects an expired timestamp", () => {
    const old = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(verifySignature(body, old, sign(body, old), SECRET)).toBe(false);
  });

  it("rejects missing signature or timestamp", () => {
    expect(verifySignature(body, undefined, sign(body, now), SECRET)).toBe(false);
    expect(verifySignature(body, now, undefined, SECRET)).toBe(false);
  });
});
