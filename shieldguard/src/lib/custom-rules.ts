import { getHostname, getRegistrableDomain } from "./url-utils";
import type { CustomRule } from "./types";

/**
 * Safety limit on how many custom rules a user can create. Chosen to stay
 * far below declarativeNetRequest's actual dynamic-rule quota (MV3 allows
 * thousands), leaving generous headroom for the per-site exception rules
 * ShieldGuard also compiles into the same dynamic rule set (see
 * syncDynamicRules in src/background/index.ts) and keeping the ID ranges
 * the two producers use trivially disjoint.
 */
export const MAX_CUSTOM_RULES = 100;

/**
 * Normalizes user input into a plain registrable domain (e.g.
 * "Sub.Ads.Example.com/path" -> "example.com" is rejected by validation
 * before this is ever called on it; this only runs on input that already
 * passed validateCustomRulePattern). Returns null if the input can't be
 * parsed as a hostname at all.
 */
export function normalizeCustomRuleDomain(pattern: string): string | null {
  const trimmed = pattern.trim().toLowerCase();
  const host = getHostname(`https://${trimmed}`);
  if (!host) return null;
  return getRegistrableDomain(host);
}

/**
 * Validates a custom-rule domain pattern against the existing rule list.
 * Returns a user-facing error message, or null if the pattern is valid and
 * not a duplicate.
 *
 * Deliberately narrow: only a plain domain is accepted. No wildcards,
 * regex, paths, or query strings -- declarativeNetRequest's urlFilter
 * syntax does support some wildcard patterns, but exposing that raw would
 * let a user (or a rule shared/copy-pasted from an untrusted source)
 * construct a rule that blocks far more than they intended, or accidentally
 * matches ShieldGuard's own extension pages. A plain domain is unambiguous
 * and safe.
 */
export function validateCustomRulePattern(pattern: string, existing: CustomRule[]): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return "Enter a domain to block.";
  if (/[*?\s/\\]/.test(trimmed)) {
    return 'Only a plain domain is supported (no wildcards, paths, or spaces) -- e.g. "annoying-ads.example".';
  }
  const domain = normalizeCustomRuleDomain(trimmed);
  if (!domain) return "That doesn't look like a valid domain.";
  if (existing.some((r) => r.domain === domain)) {
    return `A rule for "${domain}" already exists.`;
  }
  if (existing.length >= MAX_CUSTOM_RULES) {
    return `You've reached the limit of ${MAX_CUSTOM_RULES} custom rules.`;
  }
  return null;
}
