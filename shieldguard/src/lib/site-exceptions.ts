/**
 * Pure decision logic for per-site declarativeNetRequest network exceptions.
 *
 * declarativeNetRequest's static rulesets have no built-in concept of "this
 * tab's site is trusted" -- they are global on/off switches. To make Site
 * Manager's per-site Pause/Trust/category toggles actually change what gets
 * network-blocked (not just the JS-side popup-gesture and redirect-chain
 * heuristics), the background service worker mirrors this decision into
 * high-priority DYNAMIC "allow" rules scoped to each site's initiator
 * domain. This module computes WHICH exceptions should exist; the actual
 * chrome.declarativeNetRequest calls live in the background script so this
 * logic can be unit tested without a browser.
 */
import { getRegistrableDomain } from "./url-utils";
import type { CategoryToggleState, SiteSettings } from "./types";

export const DNR_BACKED_CATEGORIES = ["ads", "trackers", "popups", "redirects", "scamMalvertising"] as const;
export type DnrBackedCategory = (typeof DNR_BACKED_CATEGORIES)[number];

export interface SiteException {
  domain: string;
  category: DnrBackedCategory;
}

/**
 * True if the site's protection is currently bypassed wholesale: it's
 * explicitly trusted, or paused for the current session, or paused with a
 * future expiry timestamp that hasn't passed yet.
 */
export function isSiteBypassed(site: Pick<SiteSettings, "mode" | "pausedUntil">, now: number): boolean {
  if (site.mode === "trusted") return true;
  if (site.mode === "paused") {
    if (site.pausedUntil === "restart") return true; // paused until the next browser restart
    return !site.pausedUntil || site.pausedUntil > now;
  }
  return false;
}

/**
 * Computes the full set of (domain, category) exceptions that should exist
 * as dynamic allow rules, given the current site list and global category
 * settings. A category only needs an exception if it's globally ON (a
 * globally-off category has no static block rule active to except from) AND
 * the site wants it off, either because the whole site is bypassed or
 * because that one category is toggled off for that site specifically.
 */
export function computeSiteExceptions(
  sites: SiteSettings[],
  globalCategories: CategoryToggleState,
  now: number
): SiteException[] {
  const exceptions: SiteException[] = [];

  for (const site of sites) {
    const bypassAll = isSiteBypassed(site, now);
    const domain = getRegistrableDomain(site.domain);

    for (const category of DNR_BACKED_CATEGORIES) {
      if (!globalCategories[category]) continue;
      const siteWantsOff = bypassAll || site.categories[category] === false;
      if (!siteWantsOff) continue;
      exceptions.push({ domain, category });
    }
  }

  return exceptions;
}
