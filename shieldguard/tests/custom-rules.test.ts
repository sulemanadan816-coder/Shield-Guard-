import { describe, it, expect } from "vitest";
import { validateCustomRulePattern, normalizeCustomRuleDomain, MAX_CUSTOM_RULES } from "../src/lib/custom-rules";
import type { CustomRule } from "../src/lib/types";

function makeRule(domain: string): CustomRule {
  return { id: `rule_${domain}`, domain, enabled: true, createdAt: 0 };
}

describe("normalizeCustomRuleDomain", () => {
  it("normalizes a plain domain to itself", () => {
    expect(normalizeCustomRuleDomain("annoying-ads.example")).toBe("annoying-ads.example");
  });

  it("reduces a subdomain to its registrable domain", () => {
    expect(normalizeCustomRuleDomain("tracker.ads.example.com")).toBe("example.com");
  });

  it("is case-insensitive", () => {
    expect(normalizeCustomRuleDomain("ADS.Example.COM")).toBe("example.com");
  });

  it("returns null for input that can't be parsed as a hostname", () => {
    expect(normalizeCustomRuleDomain("")).toBeNull();
  });
});

describe("validateCustomRulePattern", () => {
  it("accepts a plain, new domain", () => {
    expect(validateCustomRulePattern("annoying-ads.example", [])).toBeNull();
  });

  it("rejects an empty pattern", () => {
    expect(validateCustomRulePattern("", [])).toMatch(/enter a domain/i);
  });

  it("rejects a pattern containing a wildcard", () => {
    expect(validateCustomRulePattern("*.example.com", [])).toMatch(/plain domain/i);
  });

  it("rejects a pattern containing a path", () => {
    expect(validateCustomRulePattern("example.com/ads", [])).toMatch(/plain domain/i);
  });

  it("rejects a pattern containing spaces", () => {
    expect(validateCustomRulePattern("example .com", [])).toMatch(/plain domain/i);
  });

  it("rejects a duplicate of an existing rule's registrable domain", () => {
    const existing = [makeRule("example.com")];
    expect(validateCustomRulePattern("sub.example.com", existing)).toMatch(/already exists/i);
  });

  it("rejects once the list is at the safe limit", () => {
    const existing = Array.from({ length: MAX_CUSTOM_RULES }, (_, i) => makeRule(`site${i}.example`));
    expect(validateCustomRulePattern("one-more.example", existing)).toMatch(/limit/i);
  });

  it("does not count against the limit when it's exactly at capacity minus one", () => {
    const existing = Array.from({ length: MAX_CUSTOM_RULES - 1 }, (_, i) => makeRule(`site${i}.example`));
    expect(validateCustomRulePattern("one-more.example", existing)).toBeNull();
  });
});
