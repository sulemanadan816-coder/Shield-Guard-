import { describe, it, expect, beforeEach } from "vitest";
import { GestureTracker } from "../src/lib/gesture-tracker";

describe("GestureTracker", () => {
  let tracker: GestureTracker;

  beforeEach(() => {
    tracker = new GestureTracker();
  });

  it("returns null when no gesture has been recorded for a tab", () => {
    expect(tracker.msSinceLastGesture(1)).toBeNull();
  });

  it("reports elapsed time since a recorded gesture", () => {
    tracker.recordGesture(1, "https://example.com");
    const elapsed = tracker.msSinceLastGesture(1);
    expect(elapsed).not.toBeNull();
    expect(elapsed as number).toBeGreaterThanOrEqual(0);
    expect(elapsed as number).toBeLessThan(100);
  });

  it("tracks separate gestures per tab", () => {
    tracker.recordGesture(1, "https://a.example");
    expect(tracker.msSinceLastGesture(2)).toBeNull();
  });

  it("counts popup bursts from the same opener", () => {
    expect(tracker.recordPopupFromOpener(5)).toBe(1);
    expect(tracker.recordPopupFromOpener(5)).toBe(2);
    expect(tracker.recordPopupFromOpener(5)).toBe(3);
    expect(tracker.recentPopupCount(5)).toBe(3);
  });

  it("clears tab state on clearTab", () => {
    tracker.recordGesture(1, "https://example.com");
    tracker.recordPopupFromOpener(1);
    tracker.clearTab(1);
    expect(tracker.msSinceLastGesture(1)).toBeNull();
    expect(tracker.recentPopupCount(1)).toBe(0);
  });
});
