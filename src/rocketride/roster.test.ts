import { describe, it, expect } from "vitest";
import { buildRoster, normalizeE164, toAvailability } from "./roster.js";
import type { PollVoteRecord } from "../contracts/types.js";

function vote(handle: string, option: "Yes" | "No"): PollVoteRecord {
  return {
    poll_id: "p1",
    participant_handle: handle,
    option_identifier: `opt-${option}`,
    option_text: option,
    voted_at: new Date().toISOString(),
  };
}

describe("buildRoster", () => {
  it("resolves names, normalizes phones, lowercases availability", () => {
    const roster = buildRoster({
      correlationId: "c1",
      tripId: "t1",
      pollId: "p1",
      votes: [vote("+14155551234", "Yes"), vote("+14155559876", "No")],
      nameMap: new Map([["+14155551234", "Alice Chen"]]),
      participantSnapshot: ["+14155551234", "+14155559876"],
      complete: true,
    });

    expect(roster.complete).toBe(true);
    expect(roster.users).toEqual([
      { name: "Alice Chen", phone_number: "+14155551234", availability: "yes" },
      { name: "+14155559876", phone_number: "+14155559876", availability: "no" },
    ]);
  });

  it("emits a partial roster (complete=false) on timeout", () => {
    const roster = buildRoster({
      correlationId: "c1",
      tripId: "t1",
      pollId: "p1",
      votes: [vote("+14155551234", "Yes")],
      nameMap: new Map(),
      participantSnapshot: ["+14155551234", "+14155559876", "+14155550000"],
      complete: false,
    });
    expect(roster.complete).toBe(false);
    expect(roster.users).toHaveLength(1);
  });

  it("excludes voters that are not in the participant snapshot", () => {
    const roster = buildRoster({
      correlationId: "c1",
      tripId: "t1",
      pollId: "p1",
      votes: [vote("+14155551234", "Yes"), vote("+19998887777", "No")],
      nameMap: new Map(),
      participantSnapshot: ["+14155551234"],
      complete: false,
    });
    expect(roster.users.map((u) => u.phone_number)).toEqual(["+14155551234"]);
  });
});

describe("normalizeE164", () => {
  it("adds +1 to 10-digit US numbers", () => {
    expect(normalizeE164("4155551234")).toBe("+14155551234");
  });
  it("keeps existing + prefixes", () => {
    expect(normalizeE164("+14155551234")).toBe("+14155551234");
  });
  it("passes through email handles", () => {
    expect(normalizeE164("user@example.com")).toBe("user@example.com");
  });
});

describe("toAvailability", () => {
  it("maps option text to lowercase availability", () => {
    expect(toAvailability("Yes")).toBe("yes");
    expect(toAvailability("NO")).toBe("no");
  });
  it("throws on unexpected option text", () => {
    expect(() => toAvailability("Maybe")).toThrow();
  });
});
