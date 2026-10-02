import { describe, it, expect } from "vitest";
import { computeSiteExceptions, isSiteBypassed } from "../src/lib/site-exceptions";
import { DEFAULT_CATEGORY_STATE } from "../src/lib/types";
import type { SiteSettings } from "../src/lib/types";

const NOW = 1_000_000_000_000;

function makeSite(overrides: Partial<SiteSettings>): SiteSettings {
  return {
    domain: "example.com",
    mode: "protected",
    categories: DEFAULT_CATEGORY_STATE,
    lockdown: false,
    addedAt: NOW,
    ...overrides
  };
}

describe("isSiteBypassed", () => {
  it("trusted sites are always bypassed", () => {
    expect(isSiteBypassed({ mode: "trusted" }, NOW)).toBe(true);
  });

  it("protected sites are never bypassed", () => {
    expect(isSiteBypassed({ mode: "protected" }, NOW)).toBe(false);
  });

  it("session-paused sites (no pausedUntil) are bypassed", () => {
    expect(isSiteBypassed({ mode: "paused" }, NOW)).toBe(true);
  });

  it("timed-pause sites are bypassed only before expiry", () => {
    expect(isSiteBypassed({ mode: "paused", pausedUntil: NOW + 1000 }, NOW)).toBe(true);
    expect(isSiteBypassed({ mode: "paused", pausedUntil: NOW - 1000 }, NOW)).toBe(false);
  });

  it("restart-scoped pauses are bypassed regardless of elapsed time (cleared only on browser restart, not by a timestamp)", () => {
    expect(isSiteBypassed({ mode: "paused", pausedUntil: "restart" }, NOW)).toBe(true);
    expect(isSiteBypassed({ mode: "paused", pausedUntil: "restart" }, NOW + 999_999_999)).toBe(true);
  });
});

describe("computeSiteExceptions", () => {
  it("produces no exceptions for a plain protected site with default categories", () => {
    const site = makeSite({});
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions).toHaveLength(0);
  });

  it("a trusted site gets an exception for every globally-on DNR-backed category", () => {
    const site = makeSite({ mode: "trusted" });
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    const categories = exceptions.map((e) => e.category).sort();
    expect(categories).toEqual(["ads", "popups", "redirects", "scamMalvertising", "trackers"].sort());
    expect(exceptions.every((e) => e.domain === "example.com")).toBe(true);
  });

  it("an expired timed pause produces no exceptions", () => {
    const site = makeSite({ mode: "paused", pausedUntil: NOW - 1000 });
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions).toHaveLength(0);
  });

  it("an active timed pause produces exceptions for all DNR-backed categories", () => {
    const site = makeSite({ mode: "paused", pausedUntil: NOW + 60_000 });
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions.length).toBe(5);
  });

  it("a protected site with one category individually disabled gets only that exception", () => {
    const site = makeSite({ categories: { ...DEFAULT_CATEGORY_STATE, ads: false } });
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions).toEqual([{ domain: "example.com", category: "ads" }]);
  });

  it("never produces an exception for a category that's already off globally", () => {
    const globallyOff = { ...DEFAULT_CATEGORY_STATE, trackers: false };
    const site = makeSite({ mode: "trusted" });
    const exceptions = computeSiteExceptions([site], globallyOff, NOW);
    expect(exceptions.find((e) => e.category === "trackers")).toBeUndefined();
  });

  it("resolves each site to its registrable domain, never a subdomain literal", () => {
    const site = makeSite({ mode: "trusted", domain: "shop.example.com" });
    const exceptions = computeSiteExceptions([site], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions.every((e) => e.domain === "example.com")).toBe(true);
  });

  it("keeps exceptions for unrelated sites independent", () => {
    const trusted = makeSite({ mode: "trusted", domain: "trusted-site.com" });
    const protectedSite = makeSite({ domain: "protected-site.com" });
    const exceptions = computeSiteExceptions([trusted, protectedSite], DEFAULT_CATEGORY_STATE, NOW);
    expect(exceptions.every((e) => e.domain === "trusted-site.com")).toBe(true);
  });
});
