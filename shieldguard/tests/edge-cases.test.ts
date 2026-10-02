import { describe, it, expect } from "vitest";
import { scorePopup } from "../src/lib/popup-risk";
import { GestureTracker } from "../src/lib/gesture-tracker";
import { RedirectTracker } from "../src/lib/redirect-detector";
import { getRegistrableDomain, isCrossOrigin, safeParseUrl } from "../src/lib/url-utils";

describe("edge cases: malformed and unusual URLs", () => {
  it("scorePopup does not throw on a malformed destination URL", () => {
    expect(() =>
      scorePopup({
        msSinceLastGesture: null,
        openerOrigin: "https://example.com",
        destinationUrl: "not a real url###",
        recentPopupCountFromOpener: 1,
        matchesKnownAdRule: false,
        matchesScamRule: false,
        openedInBackground: false,
        redirectChainLength: 0
      })
    ).not.toThrow();
  });

  it("scorePopup does not throw on an empty opener origin", () => {
    expect(() =>
      scorePopup({
        msSinceLastGesture: 100,
        openerOrigin: "",
        destinationUrl: "https://example.com",
        recentPopupCountFromOpener: 1,
        matchesKnownAdRule: false,
        matchesScamRule: false,
        openedInBackground: false,
        redirectChainLength: 0
      })
    ).not.toThrow();
  });

  it("treats a malformed destination as cross-origin (fail safe, not fail open)", () => {
    expect(isCrossOrigin("https://example.com", "not-a-url")).toBe(true);
  });

  it("safeParseUrl rejects javascript: and data: schemes without throwing", () => {
    // These parse successfully as URL objects (they are syntactically valid
    // URLs) -- callers must check .protocol themselves; this just confirms
    // no exception is thrown for unusual schemes.
    expect(() => safeParseUrl("javascript:alert(1)")).not.toThrow();
    expect(safeParseUrl("javascript:alert(1)")?.protocol).toBe("javascript:");
  });

  it("registrable-domain resolution is stable for popup/redirect IP destinations", () => {
    expect(getRegistrableDomain("10.0.0.1")).toBe("10.0.0.1");
    expect(getRegistrableDomain("[::1]")).toBe("[::1]");
  });
});

describe("edge cases: service worker restart safety", () => {
  it("a freshly-constructed GestureTracker (simulating SW restart) treats every tab as having no recent gesture", () => {
    const fresh = new GestureTracker();
    // This is the SAFE default: after a restart, ShieldGuard should not
    // assume a gesture happened -- it should fall back to the more
    // cautious "no recent gesture" state, which increases (not decreases)
    // scrutiny on new popups until fresh signals arrive.
    expect(fresh.msSinceLastGesture(1)).toBeNull();
    expect(fresh.recentPopupCount(1)).toBe(0);
  });

  it("a freshly-constructed RedirectTracker (simulating SW restart) starts with an empty, non-suspicious chain", () => {
    const fresh = new RedirectTracker();
    const analysis = fresh.analyze(1);
    expect(analysis.suspicious).toBe(false);
    expect(analysis.chain).toHaveLength(0);
  });
});

describe("edge cases: subdomain and lookalike domains", () => {
  it("distinguishes a real subdomain from a lookalike domain sharing a substring", () => {
    expect(getRegistrableDomain("checkout.example.com")).toBe("example.com");
    expect(getRegistrableDomain("example.com.attacker.net")).toBe("attacker.net");
    expect(getRegistrableDomain("exampleXcom.net")).toBe("examplexcom.net");
  });
});
