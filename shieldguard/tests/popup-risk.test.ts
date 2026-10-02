import { describe, it, expect } from "vitest";
import { scorePopup, shouldBlockPopup, tierForScore } from "../src/lib/popup-risk";

describe("popup risk scoring", () => {
  it("scores a legitimate same-origin OAuth-style popup as low risk", () => {
    const result = scorePopup({
      msSinceLastGesture: 120,
      openerOrigin: "https://app.example.com",
      destinationUrl: "https://app.example.com/oauth/start",
      recentPopupCountFromOpener: 1,
      matchesKnownAdRule: false,
      matchesScamRule: false,
      openedInBackground: false,
      redirectChainLength: 0
    });
    expect(result.tier).toBe("low");
    expect(shouldBlockPopup(result, true)).toBe(false);
  });

  it("treats a single cross-origin popup immediately after a click as low-to-medium risk (e.g. login flow)", () => {
    const result = scorePopup({
      msSinceLastGesture: 200,
      openerOrigin: "https://shop.example.com",
      destinationUrl: "https://accounts.google.com/login",
      recentPopupCountFromOpener: 1,
      matchesKnownAdRule: false,
      matchesScamRule: false,
      openedInBackground: false,
      redirectChainLength: 0
    });
    expect(result.score).toBeLessThan(60);
  });

  it("scores an automatic cross-domain ad-network popup burst as critical risk", () => {
    const result = scorePopup({
      msSinceLastGesture: null,
      openerOrigin: "https://streaming-site.example",
      destinationUrl: "https://ads.example-ad-network.com/x",
      recentPopupCountFromOpener: 4,
      matchesKnownAdRule: true,
      matchesScamRule: false,
      openedInBackground: true,
      redirectChainLength: 3
    });
    expect(result.tier).toBe("critical");
    expect(shouldBlockPopup(result, true)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("never claims a score outside 0-100", () => {
    const result = scorePopup({
      msSinceLastGesture: 0,
      openerOrigin: "https://a.example",
      destinationUrl: "https://a.example",
      recentPopupCountFromOpener: 0,
      matchesKnownAdRule: false,
      matchesScamRule: false,
      openedInBackground: false,
      redirectChainLength: 0
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("tierForScore matches the documented bands", () => {
    expect(tierForScore(0)).toBe("low");
    expect(tierForScore(29)).toBe("low");
    expect(tierForScore(30)).toBe("medium");
    expect(tierForScore(59)).toBe("medium");
    expect(tierForScore(60)).toBe("high");
    expect(tierForScore(79)).toBe("high");
    expect(tierForScore(80)).toBe("critical");
    expect(tierForScore(100)).toBe("critical");
  });
});
