import { describe, it, expect, beforeEach } from "vitest";
import { RedirectTracker } from "../src/lib/redirect-detector";

describe("RedirectTracker", () => {
  let tracker: RedirectTracker;

  beforeEach(() => {
    tracker = new RedirectTracker();
  });

  it("does not flag a single normal navigation as suspicious", () => {
    tracker.recordNavigation(1, "https://news.example.com/article");
    const analysis = tracker.analyze(1);
    expect(analysis.suspicious).toBe(false);
  });

  it("flags a fast multi-domain redirect chain as suspicious", () => {
    tracker.recordNavigation(1, "https://a.example.com");
    tracker.recordNavigation(1, "https://b.example-ads.com");
    tracker.recordNavigation(1, "https://c.example-tracker.net");
    tracker.recordNavigation(1, "https://d.final-destination.com");
    const analysis = tracker.analyze(1);
    expect(analysis.suspicious).toBe(true);
    expect(analysis.distinctDomains).toBeGreaterThanOrEqual(3);
    expect(analysis.reasons.length).toBeGreaterThan(0);
  });

  it("does not flag repeated navigation within the same domain", () => {
    tracker.recordNavigation(1, "https://example.com/page1");
    tracker.recordNavigation(1, "https://example.com/page2");
    tracker.recordNavigation(1, "https://example.com/page3");
    const analysis = tracker.analyze(1);
    expect(analysis.suspicious).toBe(false);
  });

  it("keeps chains isolated per tab", () => {
    tracker.recordNavigation(1, "https://a.com");
    tracker.recordNavigation(2, "https://b.com");
    expect(tracker.getChain(1)).toHaveLength(1);
    expect(tracker.getChain(2)).toHaveLength(1);
  });

  it("clears a tab's chain on clearTab", () => {
    tracker.recordNavigation(1, "https://a.com");
    tracker.clearTab(1);
    expect(tracker.getChain(1)).toHaveLength(0);
  });
});
