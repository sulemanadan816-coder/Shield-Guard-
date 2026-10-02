import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStorageMock } from "./chrome-mock";

installChromeStorageMock();

const { resetExtension } = await import("../src/lib/storage");
const { recordStatEvent, getStatisticsForRange, totalBlocked } = await import("../src/lib/statistics");
import type { ProtectionEvent } from "../src/lib/types";

function evt(category: ProtectionEvent["category"], action: ProtectionEvent["action"] = "blocked"): ProtectionEvent {
  return {
    id: Math.random().toString(),
    timestamp: Date.now(),
    domain: "example.com",
    category,
    reasons: [],
    action
  };
}

describe("statistics", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("starts at zero with no recorded events", async () => {
    const stats = await getStatisticsForRange("today");
    expect(totalBlocked(stats)).toBe(0);
  });

  it("only counts real recorded 'blocked' events, never fabricates numbers", async () => {
    await recordStatEvent(evt("popup"));
    await recordStatEvent(evt("popup"));
    await recordStatEvent(evt("ad"));
    const stats = await getStatisticsForRange("today");
    expect(stats.popups).toBe(2);
    expect(stats.ads).toBe(1);
    expect(stats.redirects).toBe(0);
    expect(totalBlocked(stats)).toBe(3);
  });

  it("does not count 'flagged' or 'allowed' events toward blocked totals", async () => {
    await recordStatEvent(evt("redirect", "flagged"));
    await recordStatEvent(evt("popup", "allowed"));
    const stats = await getStatisticsForRange("today");
    expect(totalBlocked(stats)).toBe(0);
  });
});
