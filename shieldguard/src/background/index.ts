/**
 * ShieldGuard background service worker.
 *
 * This is the real protection engine. It uses only legitimate, documented
 * MV3 APIs:
 *  - declarativeNetRequest (static rulesets) for network-level ad/tracker/
 *    known-popup/known-redirect/scam-domain blocking.
 *  - webNavigation.onCreatedNavigationTarget + tabs.remove for behavioral
 *    popup detection/closure of tabs that aren't caught by a static rule.
 *  - webNavigation.onBeforeNavigate/onCommitted for redirect-chain
 *    analysis and logging.
 *  - alarms for retention cleanup and daily summary notifications.
 *
 * HONESTY NOTE: Chrome's extension platform does not expose an API that
 * lets an extension prevent window.open()/target=_blank navigation from
 * ever creating a tab in the first place. What IS possible, and what this
 * engine does, is detect the new tab within milliseconds via
 * webNavigation.onCreatedNavigationTarget and close it before/soon after
 * it loads. A brief flash of the destination tab is a known, disclosed
 * limitation -- not a bug being hidden.
 */
import {
  getSettings,
  setSettings,
  getAllSiteSettings,
  getSiteSettings,
  setSiteSettings,
  removeSiteSettings,
  normalizeDomain,
  appendEvent,
  getEvents,
  replaceEvents,
  clearEvents,
  exportAll,
  importAll,
  resetExtension,
  appendReport,
  getSchedules,
  setSchedules,
  getCustomRules,
  setCustomRules
} from "../lib/storage";
import { getRegistrableDomain, getHostname, isSameOrSubdomain } from "../lib/url-utils";
import { computeSiteExceptions } from "../lib/site-exceptions";
import { normalizeCustomRuleDomain, MAX_CUSTOM_RULES } from "../lib/custom-rules";
import { gestureTracker } from "../lib/gesture-tracker";
import { redirectTracker } from "../lib/redirect-detector";
import { scorePopup, shouldBlockPopup } from "../lib/popup-risk";
import { generateId, formatBadgeCount, applyRetention, debounce } from "../lib/misc";
import { recordStatEvent, getStatisticsForRange, totalBlocked } from "../lib/statistics";
import { getProfile } from "../lib/profiles";
import { isPremium, activateLicense, refreshSubscription, logout as subLogout } from "../lib/subscription";
import { ExpectedError } from "../lib/errors";
import type {
  RuntimeMessage,
  ProtectionEvent,
  SiteSettings,
  CategoryToggleState,
  UserSettings,
  ProtectionDiagnostics,
  RulesetDiagnostic,
  ScheduleRule,
  CustomRule,
  ProtectionProfile
} from "../lib/types";

async function applyProfileSettings(profile: ProtectionProfile): Promise<UserSettings> {
  const updated = await setSettings({
    activeProfile: profile.id,
    filterLevel: profile.filterLevel,
    categories: profile.categories
  });
  await syncRulesetsWithSettings();
  return updated;
}

// ---------------------------------------------------------------------------
// Scheduled Protection (Pro)
//
// A schedule is a day-of-week + time-of-day window bound to a protection
// profile. Every 5 minutes (plus once immediately on install/startup/save,
// so a window already in effect doesn't wait for the next tick) we check
// whether a schedule matches "now" and, if so, actually apply that profile
// via the same code path SET_PROFILE uses -- not just a UI label. When no
// schedule matches and one was previously in effect, we restore the
// profile the user had selected before the window took over, tracked via
// UserSettings.preScheduleProfile/activeScheduleId. This is Pro-only,
// enforced both when saving schedules and when evaluating them, not just
// hidden in the dashboard UI.
// ---------------------------------------------------------------------------

const SCHEDULE_CHECK_ALARM = "sg_schedule_check";

function scheduleMatchesNow(rule: ScheduleRule, date: Date): boolean {
  if (!rule.enabled) return false;
  if (!rule.daysOfWeek.includes(date.getDay())) return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  if (rule.startMinute <= rule.endMinute) {
    return minute >= rule.startMinute && minute < rule.endMinute;
  }
  // Overnight window, e.g. 22:00 -> 06:00.
  return minute >= rule.startMinute || minute < rule.endMinute;
}

async function evaluateSchedules(): Promise<void> {
  if (!(await isPremium())) return; // Scheduled Protection is Pro-only
  const schedules = await getSchedules();
  const now = new Date();
  // If more than one enabled schedule matches the same moment, the first
  // one in stored order wins -- deterministic, rather than picking at
  // random. (The dashboard warns about overlapping schedules at save time.)
  const match = schedules.find((s) => scheduleMatchesNow(s, now));
  const settings = await getSettings();

  if (match) {
    if (settings.activeScheduleId === match.id) return; // already applied
    const profile = getProfile(match.profile);
    if (!profile) return; // schedule references a profile that no longer exists
    const preScheduleProfile = settings.activeScheduleId
      ? settings.preScheduleProfile
      : settings.activeProfile;
    await setSettings({ activeScheduleId: match.id, preScheduleProfile });
    await applyProfileSettings(profile);
    return;
  }

  if (settings.activeScheduleId) {
    const revertTo = settings.preScheduleProfile ? getProfile(settings.preScheduleProfile) : undefined;
    await setSettings({ activeScheduleId: undefined, preScheduleProfile: undefined });
    if (revertTo) await applyProfileSettings(revertTo);
  }
}

// ---------------------------------------------------------------------------
// Ruleset management
// ---------------------------------------------------------------------------

const RULESET_BY_CATEGORY: Record<string, string> = {
  ads: "ads_rules",
  trackers: "trackers_rules",
  popups: "popups_rules",
  redirects: "redirects_rules",
  scamMalvertising: "security_rules"
};
const ALL_RULESET_IDS = Object.values(RULESET_BY_CATEGORY);

/** Free plan: Event History (and the data it's built from) is capped to the
 * most recent N events, enforced here in the background service worker --
 * not just by how the dashboard chooses to render results -- so a free
 * account genuinely cannot read more than this via any code path. */
const FREE_TIER_EVENT_HISTORY_LIMIT = 50;

async function syncRulesetsWithSettings(): Promise<void> {
  const settings = await getSettings();
  const enable: string[] = [];
  const disable: string[] = [];

  if (!settings.protectionEnabled) {
    disable.push(...ALL_RULESET_IDS);
  } else {
    for (const [category, rulesetId] of Object.entries(RULESET_BY_CATEGORY)) {
      const on = settings.categories[category as keyof CategoryToggleState];
      (on ? enable : disable).push(rulesetId);
    }
  }

  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable
    });
  } catch (err) {
    console.error("[ShieldGuard] Failed to sync rulesets", err);
  }
}

// ---------------------------------------------------------------------------
// Per-site network exceptions
//
// The static rulesets above are global on/off switches -- declarativeNetRequest
// has no built-in concept of "this tab's site is trusted". To make Site
// Manager's per-site Pause/Trust/category toggles actually affect the
// network-level ad/tracker/popup/redirect blocking (not just the JS-side
// popup-gesture and redirect-chain heuristics elsewhere in this file), we
// mirror site exceptions into high-priority DYNAMIC declarativeNetRequest
// "allow" rules scoped to that site's initiator domain. This is the
// documented, MV3-native mechanism for per-site network exceptions -- not a
// workaround.
// ---------------------------------------------------------------------------

const RT = chrome.declarativeNetRequest.ResourceType;
const CATEGORY_RESOURCE_TYPES: Record<string, chrome.declarativeNetRequest.ResourceType[]> = {
  ads: [RT.IMAGE, RT.OTHER, RT.PING, RT.SCRIPT, RT.SUB_FRAME, RT.XMLHTTPREQUEST],
  trackers: [RT.IMAGE, RT.OTHER, RT.PING, RT.SCRIPT, RT.XMLHTTPREQUEST],
  popups: [RT.MAIN_FRAME, RT.SCRIPT, RT.SUB_FRAME],
  redirects: [RT.MAIN_FRAME, RT.SUB_FRAME],
  scamMalvertising: [RT.MAIN_FRAME, RT.SCRIPT, RT.SUB_FRAME]
};
const CUSTOM_RULE_RESOURCE_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  RT.MAIN_FRAME,
  RT.SUB_FRAME,
  RT.SCRIPT,
  RT.IMAGE,
  RT.XMLHTTPREQUEST,
  RT.OTHER,
  RT.PING
];

// Both site-exception ALLOW rules and custom-rule BLOCK rules live in the
// SAME declarativeNetRequest dynamic rule table -- chrome.declarativeNetRequest
// has one dynamic rule set per extension, not one per feature. Each producer
// therefore uses its own disjoint ID range and BOTH are recomputed and
// written together in one updateDynamicRules call (below); a version of
// this function that only knew about one producer and blindly did
// removeRuleIds: <everything> would silently delete the other's rules on
// every sync. Site-exception IDs (1..N) stay far below CUSTOM_RULE_ID_BASE,
// which itself leaves 100000 IDs of headroom before ever reaching the real
// declarativeNetRequest dynamic-rule ceiling.
const CUSTOM_RULE_ID_BASE = 100_000;

async function syncDynamicRules(): Promise<void> {
  const [allSites, globalSettings, customRules, premium] = await Promise.all([
    getAllSiteSettings(),
    getSettings(),
    getCustomRules(),
    isPremium()
  ]);
  const now = Date.now();

  const exceptions = computeSiteExceptions(Object.values(allSites), globalSettings.categories, now);
  const exceptionRules: chrome.declarativeNetRequest.Rule[] = exceptions.map((ex, i) => ({
    id: i + 1,
    priority: 100,
    action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
    condition: {
      initiatorDomains: [ex.domain],
      resourceTypes: CATEGORY_RESOURCE_TYPES[ex.category]
    }
  }));

  // Custom Rules are Pro-only, enforced here as well as at save time: if an
  // account is no longer premium (e.g. a lapsed subscription), previously
  // saved custom rules stop being compiled into the network layer entirely
  // rather than just being hidden in the UI.
  const activeCustomRules = premium ? customRules.filter((r) => r.enabled) : [];
  const customBlockRules: chrome.declarativeNetRequest.Rule[] = activeCustomRules.map((r, i) => ({
    id: CUSTOM_RULE_ID_BASE + i,
    // Lower priority than the site-exception ALLOW rules above: an explicit
    // "Trust this site" always wins over the user's own custom block rule
    // for that site, which matches what a user would expect "Trust" to mean.
    priority: 1,
    action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
    condition: {
      urlFilter: `||${r.domain}^`,
      resourceTypes: CUSTOM_RULE_RESOURCE_TYPES
    }
  }));

  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: [...exceptionRules, ...customBlockRules]
    });
  } catch (err) {
    console.error("[ShieldGuard] Failed to sync dynamic rules", err);
  }
}

function schedulePauseExpiry(domain: string, pausedUntil: number): void {
  chrome.alarms.create(`sg_site_pause_expiry_${domain}`, { when: pausedUntil });
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function refreshBadge(): Promise<void> {
  const settings = await getSettings();
  if (!settings.showBadgeCounter) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const todayStats = await getStatisticsForRange("today");
  const count = totalBlocked(todayStats);
  await chrome.action.setBadgeText({ text: formatBadgeCount(count) });
  await chrome.action.setBadgeBackgroundColor({ color: "#2f6fed" });
}

const refreshBadgeDebounced = debounce(() => void refreshBadge(), 250);

// ---------------------------------------------------------------------------
// Site protection resolution
// ---------------------------------------------------------------------------

async function isSiteActivelyProtected(hostname: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.protectionEnabled) return false;

  const all = await getAllSiteSettings();
  const domain = getRegistrableDomain(hostname);
  // Look for an exact host entry first, then a registrable-domain entry.
  const entry =
    all[normalizeDomain(hostname)] ??
    Object.values(all).find((s) => isSameOrSubdomain(hostname, s.domain));

  if (!entry) return true;
  if (entry.mode === "trusted") return false;
  if (entry.mode === "paused") {
    if (entry.pausedUntil === "restart") return false; // cleared by onStartup below
    if (!entry.pausedUntil) return false; // paused until manually re-enabled
    if (Date.now() < entry.pausedUntil) return false;
  }
  return true;
}

/** "Pause until browser restart" entries are cleared here, on the one event
 * that actually represents a browser restart (as opposed to the frequent,
 * unrelated service-worker suspend/wake cycle that MV3 background workers
 * go through, which must NOT clear these). */
async function clearRestartScopedPauses(): Promise<void> {
  const all = await getAllSiteSettings();
  for (const site of Object.values(all)) {
    if (site.mode === "paused" && site.pausedUntil === "restart") {
      site.mode = "protected";
      site.pausedUntil = undefined;
      await setSiteSettings(site);
    }
  }
}

async function getEffectiveCategoriesFor(hostname: string): Promise<CategoryToggleState> {
  const settings = await getSettings();
  const all = await getAllSiteSettings();
  const entry =
    all[normalizeDomain(hostname)] ??
    Object.values(all).find((s) => isSameOrSubdomain(hostname, s.domain));
  return entry ? entry.categories : settings.categories;
}

// ---------------------------------------------------------------------------
// Event logging
// ---------------------------------------------------------------------------

async function logEvent(event: Omit<ProtectionEvent, "id" | "timestamp">): Promise<void> {
  const settings = await getSettings();
  if (!settings.logBlockedEvents) return; // user has disabled event/statistics logging entirely

  const full: ProtectionEvent = { ...event, id: generateId(), timestamp: Date.now() };
  await appendEvent(full);
  await recordStatEvent(full);
  refreshBadgeDebounced();

  if (settings.showSummaryNotifications) {
    scheduleSummaryNotificationCheck();
  }
}

// ---------------------------------------------------------------------------
// Popup protection: webNavigation.onCreatedNavigationTarget
// ---------------------------------------------------------------------------

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId, url } = details;
  try {
    const openerTab = await chrome.tabs.get(sourceTabId).catch(() => undefined);
    const openerUrl = openerTab?.url ?? "";
    const openerHost = getHostname(openerUrl);
    if (!openerHost) return;

    const settings = await getSettings();
    if (!settings.protectionEnabled || !settings.categories.popups) return;
    if (!(await isSiteActivelyProtected(openerHost))) return;

    const effectiveCategories = await getEffectiveCategoriesFor(openerHost);
    if (!effectiveCategories.popups) return;

    const recentPopupCount = gestureTracker.recordPopupFromOpener(sourceTabId);
    const msSinceGesture = gestureTracker.msSinceLastGesture(sourceTabId);
    const redirectAnalysis = redirectTracker.analyze(sourceTabId);

    const newTab = await chrome.tabs.get(tabId).catch(() => undefined);
    const openedInBackground = newTab ? newTab.active === false : false;

    // Signal: is the destination itself a site the user has already
    // explicitly trusted? A trusted destination is strong evidence this
    // isn't unwanted-popup abuse, even if the opener is untrusted.
    const destinationHost = getHostname(url);
    let destinationTrusted = false;
    if (destinationHost) {
      const destSite = await getSiteSettings(getRegistrableDomain(destinationHost));
      destinationTrusted = destSite?.mode === "trusted";
    }
    if (destinationTrusted) {
      return; // never block a popup whose destination the user has trusted
    }

    const result = scorePopup({
      msSinceLastGesture: msSinceGesture,
      openerOrigin: openerUrl,
      destinationUrl: url,
      recentPopupCountFromOpener: recentPopupCount,
      matchesKnownAdRule: false, // domains on our static lists are already blocked at the network layer
      matchesScamRule: false,
      openedInBackground,
      redirectChainLength: redirectAnalysis.distinctDomains
    });

    const domain = getRegistrableDomain(openerHost);

    if (shouldBlockPopup(result, settings.allowUserInitiatedPopups)) {
      if (settings.closeSuspiciousTabsAutomatically) {
        await chrome.tabs.remove(tabId).catch(() => undefined);
      }
      await logEvent({
        domain,
        destinationUrl: url,
        category: "popup",
        reasons: result.reasons,
        riskScore: result.score,
        action: settings.closeSuspiciousTabsAutomatically ? "blocked" : "flagged",
        tabId
      });
    }
  } catch (err) {
    console.error("[ShieldGuard] popup handling error", err);
  }
});

// ---------------------------------------------------------------------------
// Redirect chain tracking + interception.
//
// HONESTY NOTE: webNavigation events are observational -- there is no
// "preventDefault" for an in-flight navigation. What IS legitimate and
// reliable is racing chrome.tabs.update() from the onBeforeNavigate
// listener to send the tab to our own Redirect Shield interstitial before
// the flagged destination finishes loading. This is a best-effort
// diversion (same category of limitation as the popup engine's tab
// closure), not a guaranteed pre-navigation block.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Redirect chain tracking + interception.
//
// HONESTY NOTE: webNavigation events are observational -- there is no
// "preventDefault" for an in-flight navigation. What IS legitimate and
// reliable is racing chrome.tabs.update() from the onBeforeNavigate
// listener to send the tab somewhere else before the flagged destination
// finishes loading. This is a best-effort diversion (same category of
// limitation as the popup engine's tab closure), not a guaranteed
// pre-navigation block.
//
// DEFAULT BEHAVIOR (Quiet Protection Mode, on by default): a suspicious
// chain is NEVER diverted to our own redirect-shield.html interstitial.
// Instead we divert back to the earliest still-tracked URL for that tab --
// i.e. the page the user was actually on before the automatic redirect
// sequence started -- so browsing stays smooth and the user never leaves
// the site they meant to be on. If no safe prior URL is known, or we've
// already diverted this tab once recently (see recentDiversions below,
// which exists specifically to prevent divert/redirect loops), we do NOT
// guess or use history.back(): we simply let the navigation proceed and
// log it as "flagged" rather than "blocked".
//
// The only time the full-page interstitial still appears automatically is
// when Quiet Protection Mode is turned OFF *and* the chain is high
// severity (see RedirectAnalysis.severity in redirect-detector.ts: a
// same-domain navigation loop, or an unusually large number of distinct
// domains). That is a deliberate, narrow exception for the cases where a
// user genuinely may want to make an explicit decision, per the project's
// "Option B" requirement. In every other case, and always when Quiet
// Protection Mode is on, redirect-shield.html is only ever reachable
// manually, as a "Review" action from Event History.
// ---------------------------------------------------------------------------

/** One-time bypass keys ("tabId:url") set when the user approves a
 * previously-flagged destination from the Redirect Shield page (only
 * reachable today via the narrow high-severity/quiet-mode-off path, or
 * manually from Event History). */
const redirectBypass = new Set<string>();

/** Tracks the last tab we diverted away from a suspicious chain, and when,
 * so a page that keeps re-triggering the same redirect can't force us into
 * a divert/redirect loop -- after one diversion per tab within the cooldown
 * window we back off and just log instead of intervening again. */
const recentDiversions = new Map<number, { url: string; at: number }>();
const DIVERSION_COOLDOWN_MS = 15_000;

function isExtensionUrl(url: string): boolean {
  return url.startsWith(chrome.runtime.getURL(""));
}

function buildRedirectShieldUrl(dest: string, domain: string, reasons: string[]): string {
  const params = new URLSearchParams({ dest, domain, reasons: JSON.stringify(reasons) });
  return chrome.runtime.getURL(`redirect-shield.html?${params.toString()}`);
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  const url = details.url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (isExtensionUrl(url)) return;

  const bypassKey = `${details.tabId}:${url}`;
  if (redirectBypass.has(bypassKey)) {
    redirectBypass.delete(bypassKey);
    return;
  }

  // Require at least two prior hops already recorded for this tab before
  // treating the *next* hop as chain continuation worth interrupting --
  // this avoids intercepting a site's very first, single navigation (a
  // normal link click, typed URL, or bookmark is never flagged).
  const existingChain = redirectTracker.getChain(details.tabId);
  if (existingChain.length < 2) return;

  const analysis = redirectTracker.analyze(details.tabId);
  if (!analysis.suspicious) return;

  const settings = await getSettings();
  if (!settings.protectionEnabled || !settings.categories.redirects || !settings.blockSuspiciousRedirectChains) {
    return;
  }

  const hostname = getHostname(url);
  if (!hostname) return;
  if (!(await isSiteActivelyProtected(hostname))) return;

  const domain = getRegistrableDomain(hostname);

  // Destination already explicitly trusted by the user? Never intervene,
  // regardless of how the chain looks -- an explicit trust decision wins.
  const destSite = await getSiteSettings(domain);
  if (destSite?.mode === "trusted") return;

  // A recent, genuine user gesture in this tab is strong evidence the
  // navigation was intentional (e.g. clicking "Pay with PayPal", which
  // legitimately bounces through several domains fast). Downgrade the
  // severity we act on accordingly rather than blocking outright.
  const msSinceGesture = gestureTracker.msSinceLastGesture(details.tabId);
  const hadRecentGesture = msSinceGesture !== null && msSinceGesture <= 3000;
  const effectiveSeverity = hadRecentGesture && analysis.severity === "high" ? "medium" : analysis.severity;

  const showInterstitial = !settings.quietProtectionMode && effectiveSeverity === "high";

  if (showInterstitial) {
    const interstitialUrl = buildRedirectShieldUrl(url, domain, analysis.reasons);
    try {
      await chrome.tabs.update(details.tabId, { url: interstitialUrl });
    } catch (err) {
      console.error("[ShieldGuard] failed to divert to Redirect Shield", err);
      return;
    }
    // The flagged destination never committed; drop the chain so a
    // subsequent "Continue"/"Trust Site" choice starts clean.
    redirectTracker.clearTab(details.tabId);
    await logEvent({
      domain,
      destinationUrl: url,
      category: "redirect",
      reasons: analysis.reasons,
      riskScore: analysis.severity === "high" ? 90 : analysis.severity === "medium" ? 55 : 20,
      action: "blocked",
      tabId: details.tabId
    });
    return;
  }

  // Quiet path (the default): try to divert back to the page the user was
  // actually on, without ever showing a full-page warning.
  const lastDiversion = recentDiversions.get(details.tabId);
  const cooledDown = !lastDiversion || Date.now() - lastDiversion.at > DIVERSION_COOLDOWN_MS;
  const safeFallbackUrl = redirectTracker.earliestKnownGoodUrl(details.tabId);
  const fallbackIsUsable =
    !!safeFallbackUrl &&
    safeFallbackUrl !== url &&
    !isExtensionUrl(safeFallbackUrl) &&
    getRegistrableDomain(getHostname(safeFallbackUrl) ?? "") !== domain;

  if (cooledDown && fallbackIsUsable) {
    try {
      await chrome.tabs.update(details.tabId, { url: safeFallbackUrl! });
      recentDiversions.set(details.tabId, { url: safeFallbackUrl!, at: Date.now() });
      redirectTracker.clearTab(details.tabId);
      await logEvent({
        domain,
        destinationUrl: url,
        category: "redirect",
        reasons: analysis.reasons,
        riskScore: effectiveSeverity === "high" ? 80 : effectiveSeverity === "medium" ? 50 : 15,
        action: "blocked",
        tabId: details.tabId
      });
    } catch (err) {
      console.error("[ShieldGuard] failed to divert redirect chain quietly", err);
    }
    return;
  }

  // No safe destination to fall back to, or we already intervened on this
  // tab too recently to safely do it again without risking a loop: don't
  // guess, don't use history.back(), just let it proceed and record it as
  // flagged (not blocked) so Event History still reflects what happened.
  await logEvent({
    domain,
    destinationUrl: url,
    category: "redirect",
    reasons: analysis.reasons,
    riskScore: effectiveSeverity === "high" ? 70 : effectiveSeverity === "medium" ? 40 : 10,
    action: "flagged",
    tabId: details.tabId
  });
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  if (isExtensionUrl(details.url)) return; // don't pollute the chain with our own interstitial
  if (!details.url.startsWith("http://") && !details.url.startsWith("https://")) return;
  redirectTracker.recordNavigation(details.tabId, details.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  gestureTracker.clearTab(tabId);
  redirectTracker.clearTab(tabId);
  recentDiversions.delete(tabId);
});

// ---------------------------------------------------------------------------
// Messaging
//
// SECURITY: this extension declares no `externally_connectable` in the
// manifest, so chrome.runtime.onMessage is already restricted to contexts
// belonging to this extension (its own popup/dashboard/background) plus
// content scripts we ourselves inject on the page. It is NOT reachable
// from arbitrary web page JS. We still defensively re-check sender.id
// below in case that manifest configuration ever changes, and we validate
// that the message has a recognized `type` before doing anything with it,
// so a malformed or unexpected payload from any context fails closed
// instead of being partially processed.
// ---------------------------------------------------------------------------

const KNOWN_MESSAGE_TYPES = new Set<RuntimeMessage["type"]>([
  "GET_TAB_STATE",
  "GET_CURRENT_TAB_STATE",
  "GET_SETTINGS",
  "SET_SETTINGS",
  "GET_SITE_SETTINGS",
  "GET_ALL_SITES",
  "ALLOW_REDIRECT_ONCE",
  "SET_SITE_SETTINGS",
  "PAUSE_SITE",
  "TRUST_SITE",
  "RESET_SITE",
  "GET_STATISTICS",
  "GET_EVENTS",
  "CLEAR_EVENTS",
  "EVENT_DECISION",
  "GET_SUBSCRIPTION",
  "ACTIVATE_LICENSE",
  "REFRESH_SUBSCRIPTION",
  "LOGOUT",
  "SET_PROFILE",
  "REPORT_BROKEN_SITE",
  "EXPORT_SETTINGS",
  "IMPORT_SETTINGS",
  "RESET_EXTENSION",
  "COSMETIC_OVERLAY_REMOVED",
  "POPUP_GESTURE",
  "GET_DIAGNOSTICS",
  "GET_SCHEDULES",
  "SET_SCHEDULES",
  "GET_CUSTOM_RULES",
  "SET_CUSTOM_RULES"
]);

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    console.warn("[ShieldGuard] rejected message from unexpected sender", sender.id);
    sendResponse({ error: "Unauthorized sender" });
    return false;
  }
  if (!message || typeof message !== "object" || !KNOWN_MESSAGE_TYPES.has(message.type)) {
    sendResponse({ error: "Unknown message type" });
    return false;
  }
  handleMessage(message, sender).then(sendResponse, (err) => {
    if (err instanceof ExpectedError) {
      // Routine, user-facing validation failure (bad license key format,
      // malformed import file, etc.) -- this is normal application flow,
      // not a bug, so it must NOT show up in chrome://extensions' "Errors"
      // list. Return the message quietly instead.
      sendResponse({ error: err.message });
      return;
    }
    console.error("[ShieldGuard] message handler error", err);
    sendResponse({ error: String(err) });
  });
  return true; // keep the channel open for the async response
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "GET_TAB_STATE": {
      const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      const hostname = tab?.url ? getHostname(tab.url) : null;
      const domain = hostname ? getRegistrableDomain(hostname) : null;
      const settings = await getSettings();
      const site = domain ? await getSiteSettings(domain) : undefined;
      const protectedNow = hostname ? await isSiteActivelyProtected(hostname) : false;
      const today = await getStatisticsForRange("today");
      return { domain, settings, site, protectedNow, today };
    }
    case "GET_CURRENT_TAB_STATE": {
      const tabId = sender.tab?.id;
      const hostname = sender.tab?.url ? getHostname(sender.tab.url) : null;
      const settings = await getSettings();
      const domain = hostname ? getRegistrableDomain(hostname) : null;
      const site = domain ? await getSiteSettings(domain) : undefined;
      const protectedNow = hostname ? await isSiteActivelyProtected(hostname) : false;
      return { tabId, domain, settings, site, protectedNow };
    }
    case "GET_SETTINGS":
      return getSettings();
    case "SET_SETTINGS": {
      const updated = await setSettings(message.settings);
      await syncRulesetsWithSettings();
      await syncDynamicRules();
      refreshBadgeDebounced();
      return updated;
    }
    case "GET_SITE_SETTINGS":
      return getSiteSettings(message.domain);
    case "GET_ALL_SITES":
      return getAllSiteSettings();
    case "ALLOW_REDIRECT_ONCE":
      redirectBypass.add(`${message.tabId}:${message.url}`);
      return { ok: true };
    case "SET_SITE_SETTINGS":
      await setSiteSettings(message.site);
      await syncDynamicRules();
      return { ok: true };
    case "PAUSE_SITE": {
      const domain = normalizeDomain(message.domain);
      const existing = await getSiteSettings(domain);
      const settings = await getSettings();
      const site: SiteSettings = existing ?? {
        domain,
        mode: "protected",
        categories: settings.categories,
        lockdown: false,
        addedAt: Date.now()
      };
      site.mode = "paused";
      if (message.durationMs === "manual") {
        site.pausedUntil = undefined; // paused until manually re-enabled
      } else if (message.durationMs === "restart") {
        site.pausedUntil = "restart"; // cleared on next chrome.runtime.onStartup
      } else {
        site.pausedUntil = Date.now() + message.durationMs;
      }
      await setSiteSettings(site);
      if (typeof site.pausedUntil === "number") schedulePauseExpiry(domain, site.pausedUntil);
      await syncDynamicRules();
      return { ok: true };
    }
    case "TRUST_SITE": {
      const domain = normalizeDomain(message.domain);
      const existing = await getSiteSettings(domain);
      const settings = await getSettings();
      const site: SiteSettings = existing ?? {
        domain,
        mode: "protected",
        categories: settings.categories,
        lockdown: false,
        addedAt: Date.now()
      };
      site.mode = "trusted";
      await setSiteSettings(site);
      await syncDynamicRules();
      return { ok: true };
    }
    case "RESET_SITE":
      await removeSiteSettings(message.domain);
      await syncDynamicRules();
      return { ok: true };
    case "GET_STATISTICS":
      return getStatisticsForRange(message.range);
    case "GET_EVENTS": {
      const events = await getEvents();
      let filtered = events;
      if (message.filter && message.filter !== "all") {
        filtered = filtered.filter((e) => e.category === message.filter);
      }
      if (message.search) {
        const q = message.search.toLowerCase();
        filtered = filtered.filter(
          (e) => e.domain.toLowerCase().includes(q) || (e.destinationUrl ?? "").toLowerCase().includes(q)
        );
      }
      filtered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
      // Enforced here, not just in how the dashboard chooses to display
      // results: free accounts only ever get the most recent
      // FREE_TIER_EVENT_HISTORY_LIMIT events, however large a limit they ask
      // for or however much history actually exists in storage.
      if (!(await isPremium())) {
        filtered = filtered.slice(0, FREE_TIER_EVENT_HISTORY_LIMIT);
      }
      return message.limit ? filtered.slice(0, message.limit) : filtered;
    }
    case "CLEAR_EVENTS":
      await clearEvents();
      return { ok: true };
    case "EVENT_DECISION": {
      const events = await getEvents();
      const target = events.find((e) => e.id === message.eventId);
      if (target && message.decision === "trust_domain") {
        const existing = await getSiteSettings(target.domain);
        const settings = await getSettings();
        const site: SiteSettings = existing ?? {
          domain: target.domain,
          mode: "protected",
          categories: settings.categories,
          lockdown: false,
          addedAt: Date.now()
        };
        site.mode = "trusted";
        await setSiteSettings(site);
        await syncDynamicRules();
      }
      return { ok: true };
    }
    case "GET_SUBSCRIPTION":
      return isPremium().then(async (premium) => ({ premium, subscription: await refreshSubscription() }));
    case "ACTIVATE_LICENSE":
      return activateLicense(message.key);
    case "REFRESH_SUBSCRIPTION":
      return refreshSubscription();
    case "LOGOUT":
      return subLogout();
    case "SET_PROFILE": {
      const profile = getProfile(message.profile);
      if (!profile) throw new Error("Unknown profile");
      // SECURITY: this is enforced here, not just hidden in the dashboard UI --
      // a free user calling this message directly (e.g. from devtools) is
      // still denied a Pro-only profile.
      if (profile.isPremium && !(await isPremium())) {
        return { error: "premium_required", message: `"${profile.name}" is a ShieldGuard Pro profile.` };
      }
      return applyProfileSettings(profile);
    }
    case "REPORT_BROKEN_SITE":
      await appendReport({ ...message.report, id: generateId(), timestamp: Date.now() });
      return { ok: true };
    case "EXPORT_SETTINGS":
      return exportAll();
    case "IMPORT_SETTINGS":
      await importAll(message.payload);
      await syncRulesetsWithSettings();
      await syncDynamicRules();
      return { ok: true };
    case "RESET_EXTENSION":
      await resetExtension();
      await syncRulesetsWithSettings();
      await syncDynamicRules();
      await refreshBadge();
      return { ok: true };
    case "COSMETIC_OVERLAY_REMOVED": {
      const senderTabId = sender.tab?.id;
      await logEvent({
        domain: getRegistrableDomain(message.domain),
        category: "overlay",
        reasons: [message.reason],
        action: "blocked",
        tabId: senderTabId
      });
      return { ok: true };
    }
    case "POPUP_GESTURE": {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        gestureTracker.recordGesture(tabId, message.targetOrigin);
      }
      return { ok: true };
    }
    case "GET_DIAGNOSTICS":
      return getDiagnostics();
    case "GET_SCHEDULES":
      return getSchedules();
    case "SET_SCHEDULES": {
      if (!(await isPremium())) {
        return { error: "premium_required", message: "Scheduled Protection is a ShieldGuard Pro feature." };
      }
      // Validate before persisting -- a malformed schedule would otherwise
      // silently never trigger, which is worse than rejecting it outright.
      for (const rule of message.schedules) {
        if (!getProfile(rule.profile)) {
          throw new ExpectedError(`Schedule "${rule.label || rule.id}" references an unknown profile.`);
        }
        if (rule.startMinute < 0 || rule.startMinute > 1439 || rule.endMinute < 0 || rule.endMinute > 1439) {
          throw new ExpectedError(`Schedule "${rule.label || rule.id}" has an invalid time range.`);
        }
        if (rule.daysOfWeek.length === 0 || rule.daysOfWeek.some((d) => d < 0 || d > 6)) {
          throw new ExpectedError(`Schedule "${rule.label || rule.id}" has no valid days selected.`);
        }
      }
      await setSchedules(message.schedules);
      await evaluateSchedules();
      return { ok: true };
    }
    case "GET_CUSTOM_RULES":
      return getCustomRules();
    case "SET_CUSTOM_RULES": {
      if (!(await isPremium())) {
        return { error: "premium_required", message: "Custom Rules is a ShieldGuard Pro feature." };
      }
      // Re-validate every rule server-side too -- the dashboard already
      // validates on entry, but a message sent directly (or a future UI
      // bug) must not be able to persist something that would silently
      // fail to compile into a network rule, or exceed the safe limit.
      const seen = new Set<string>();
      for (const rule of message.rules) {
        const normalized = normalizeCustomRuleDomain(rule.domain);
        if (!normalized || normalized !== rule.domain) {
          throw new ExpectedError(`"${rule.domain}" is not a valid, normalized domain.`);
        }
        if (seen.has(rule.domain)) {
          throw new ExpectedError(`Duplicate rule for "${rule.domain}".`);
        }
        seen.add(rule.domain);
      }
      if (message.rules.length > MAX_CUSTOM_RULES) {
        throw new ExpectedError(`You can have at most ${MAX_CUSTOM_RULES} custom rules.`);
      }
      await setCustomRules(message.rules);
      await syncDynamicRules();
      return { ok: true };
    }
    default:
      return { error: "Unknown message type" };
  }
}

async function getDiagnostics(): Promise<ProtectionDiagnostics> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
    declarative_net_request?: { rule_resources: { id: string; path: string; enabled: boolean }[] };
    minimum_chrome_version?: string;
  };
  const [settings, allSites, events, enabledRulesets, dynamicRules, bytesInUse, premium] = await Promise.all([
    getSettings(),
    getAllSiteSettings(),
    getEvents(),
    chrome.declarativeNetRequest.getEnabledRulesets(),
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.storage.local.getBytesInUse(null),
    isPremium()
  ]);

  const declaredRulesets = manifest.declarative_net_request?.rule_resources ?? [];
  const rulesets: RulesetDiagnostic[] = await Promise.all(
    declaredRulesets.map(async (r) => {
      let ruleCount: number | null = null;
      try {
        const res = await fetch(chrome.runtime.getURL(r.path));
        const json = (await res.json()) as unknown[];
        ruleCount = Array.isArray(json) ? json.length : null;
      } catch {
        ruleCount = null; // file missing/unreadable is itself worth surfacing as null, not a thrown error
      }
      return { id: r.id, enabled: enabledRulesets.includes(r.id), ruleCount };
    })
  );

  const sortedEvents = [...events].sort((a, b) => b.timestamp - a.timestamp);
  const last = sortedEvents[0];

  const warnings: string[] = [];
  if (!settings.protectionEnabled) warnings.push("Protection is currently turned off entirely.");
  if (Object.values(settings.categories).every((v) => !v)) {
    warnings.push("Every protection category is disabled -- ShieldGuard is not blocking anything.");
  }
  const missingRulesets = rulesets.filter((r) => !r.enabled);
  if (missingRulesets.length > 0) {
    warnings.push(`${missingRulesets.length} bundled ruleset(s) are not enabled: ${missingRulesets.map((r) => r.id).join(", ")}.`);
  }
  const unreadableRulesets = rulesets.filter((r) => r.ruleCount === null);
  if (unreadableRulesets.length > 0) {
    warnings.push(`${unreadableRulesets.length} ruleset file(s) could not be read to count their rules.`);
  }
  if (settings.retention === "disabled") {
    warnings.push("Event history logging is set to Disabled in Settings -- Event History and statistics will stay empty.");
  }

  return {
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    minimumChromeVersion: manifest.minimum_chrome_version ?? "unknown",
    protectionEnabled: settings.protectionEnabled,
    activeProfile: settings.activeProfile,
    rulesets,
    dynamicSiteExceptionRuleCount: dynamicRules.filter((r) => r.id < CUSTOM_RULE_ID_BASE).length,
    dynamicCustomRuleCount: dynamicRules.filter((r) => r.id >= CUSTOM_RULE_ID_BASE).length,
    lastProtectionEvent: last ? { timestamp: last.timestamp, category: last.category, domain: last.domain } : null,
    storageBytesInUse: bytesInUse,
    eventCount: events.length,
    siteCount: Object.keys(allSites).length,
    plan: premium ? "pro" : "free",
    warnings
  };
}

// ---------------------------------------------------------------------------
// Alarms: retention cleanup + daily summary notification
// ---------------------------------------------------------------------------

const RETENTION_ALARM = "sg_retention_cleanup";
const SUMMARY_ALARM = "sg_daily_summary";

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETENTION_ALARM) void runRetentionCleanup();
  if (alarm.name === SUMMARY_ALARM) void maybeSendSummaryNotification();
  if (alarm.name.startsWith("sg_site_pause_expiry_")) void syncDynamicRules();
  if (alarm.name === SCHEDULE_CHECK_ALARM) void evaluateSchedules();
});

async function runRetentionCleanup(): Promise<void> {
  const settings = await getSettings();
  const events = await getEvents();
  const kept = applyRetention(events, settings.retention);
  if (kept.length !== events.length) {
    await replaceEvents(kept);
  }
}

let lastSummaryNotificationDay = "";
function scheduleSummaryNotificationCheck(): void {
  // Debounced via alarm; the alarm handler itself decides whether to fire.
}

async function maybeSendSummaryNotification(): Promise<void> {
  const settings = await getSettings();
  if (!settings.showSummaryNotifications) return;
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastSummaryNotificationDay) return;
  const stats = await getStatisticsForRange("today");
  const total = totalBlocked(stats);
  if (total === 0) return;
  lastSummaryNotificationDay = today;

  // Group by category rather than just a bare total, so the notification
  // is actually informative -- e.g. "12 trackers, 3 popups" -- and never
  // exceeds one notification for however many events occurred today.
  const byCategory: { label: string; count: number }[] = [
    { label: "popup", count: stats.popups },
    { label: "ad", count: stats.ads },
    { label: "redirect", count: stats.redirects },
    { label: "tracker", count: stats.trackers },
    { label: "overlay", count: stats.overlays }
  ]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const top = byCategory.slice(0, 2);
  const breakdown = top.map((c) => `${c.count} ${c.label}${c.count === 1 ? "" : "s"}`).join(", ");
  const message =
    byCategory.length > top.length
      ? `ShieldGuard blocked ${breakdown}, and more (${total} total) today.`
      : `ShieldGuard blocked ${breakdown || `${total} event${total === 1 ? "" : "s"}`} today.`;

  chrome.notifications.create(`sg-summary-${today}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "ShieldGuard",
    message
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await syncRulesetsWithSettings();
  await syncDynamicRules();
  await refreshBadge();
  chrome.alarms.create(RETENTION_ALARM, { periodInMinutes: 60 * 6 });
  chrome.alarms.create(SUMMARY_ALARM, { periodInMinutes: 60 * 2 });
  chrome.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 5 });
  await evaluateSchedules();
});

chrome.runtime.onStartup.addListener(async () => {
  await clearRestartScopedPauses();
  await syncRulesetsWithSettings();
  await syncDynamicRules();
  await refreshBadge();
  chrome.alarms.create(SCHEDULE_CHECK_ALARM, { periodInMinutes: 5 });
  await evaluateSchedules();
});
