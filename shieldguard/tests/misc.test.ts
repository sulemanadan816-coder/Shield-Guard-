import { describe, it, expect, vi } from "vitest";
import { formatBadgeCount, applyRetention, generateId, debounce } from "../src/lib/misc";
import type { ProtectionEvent } from "../src/lib/types";

function makeEvent(id: string, timestamp: number): ProtectionEvent {
  return { id, timestamp, domain: "example.com", category: "ad", reasons: [], action: "blocked" };
}

describe("formatBadgeCount", () => {
  it("shows empty string for zero or negative", () => {
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(-1)).toBe("");
  });
  it("shows exact numbers under 100", () => {
    expect(formatBadgeCount(5)).toBe("5");
    expect(formatBadgeCount(99)).toBe("99");
  });
  it("caps at 99+", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(5000)).toBe("99+");
  });
});

describe("applyRetention", () => {
  const now = 1_000_000_000_000; // fixed reference point
  const events = [
    makeEvent("old", now - 40 * 24 * 60 * 60 * 1000),
    makeEvent("mid", now - 10 * 24 * 60 * 60 * 1000),
    makeEvent("new", now - 1 * 24 * 60 * 60 * 1000)
  ];

  it("keeps everything for 'forever'", () => {
    expect(applyRetention(events, "forever", now)).toHaveLength(3);
  });

  it("keeps nothing for 'disabled'", () => {
    expect(applyRetention(events, "disabled", now)).toHaveLength(0);
  });

  it("filters by 30 day window", () => {
    const kept = applyRetention(events, "30d", now);
    expect(kept.map((e) => e.id)).toEqual(["mid", "new"]);
  });

  it("filters by 7 day window", () => {
    const kept = applyRetention(events, "7d", now);
    expect(kept.map((e) => e.id)).toEqual(["new"]);
  });
});

describe("generateId", () => {
  it("produces unique-looking ids", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("debounce", () => {
  it("only invokes once after rapid calls", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
