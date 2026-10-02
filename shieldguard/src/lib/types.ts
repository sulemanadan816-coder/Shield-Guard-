/**
 * ShieldGuard shared type definitions.
 * These types define the storage schema and cross-context message contracts.
 * Keep this file dependency-free so it can be imported from background,
 * content, popup and dashboard bundles alike.
 */

export type ProtectionCategory =
  | "popups"
  | "redirects"
  | "ads"
  | "trackers"
  | "annoyances"
  | "socialWidgets"
  | "cryptoMining"
  | "scamMalvertising"
  | "overlays";

export type FilterLevel = "basic" | "balanced" | "strict" | "lockdown" | "custom";

export type ProtectionProfileId =
  | "balanced"
  | "streaming"
  | "downloading"
  | "privacy"
  | "lockdown"
  | "custom";

export type ThemePreference = "system" | "light" | "dark";

export type RetentionPolicy = "7d" | "30d" | "90d" | "forever" | "disabled";

export interface CategoryToggleState {
  popups: boolean;
  redirects: boolean;
  ads: boolean;
  trackers: boolean;
  annoyances: boolean;
  socialWidgets: boolean;
  cryptoMining: boolean;
  scamMalvertising: boolean;
  overlays: boolean;
}

export const DEFAULT_CATEGORY_STATE: CategoryToggleState = {
  popups: true,
  redirects: true,
  ads: true,
  trackers: true,
  annoyances: true,
  socialWidgets: false,
  cryptoMining: true,
  scamMalvertising: true,
  overlays: true
};

/** Global, extension-wide configuration. */
export interface UserSettings {
  protectionEnabled: boolean;
  startProtectionAutomatically: boolean;
  showBadgeCounter: boolean;
  showSummaryNotifications: boolean;
  filterLevel: FilterLevel;
  categories: CategoryToggleState;
  activeProfile: ProtectionProfileId;
  theme: ThemePreference;
  reducedMotion: boolean;
  locale: string;
  retention: RetentionPolicy;
  closeSuspiciousTabsAutomatically: boolean;
  allowUserInitiatedPopups: boolean;
  blockSuspiciousRedirectChains: boolean;
  cloudReputationOptIn: boolean;
  /**
   * When true (default), a suspicious redirect never navigates the user's
   * current tab to the Redirect Shield interstitial. The chain is diverted
   * back to the last known-good page (when one can be identified safely)
   * or simply logged, and the interstitial is only ever reachable manually
   * from Event History. When false, a high-confidence/high-severity chain
   * (see RedirectAnalysis.severity) may still show the interstitial so the
   * user can make an explicit decision -- this is the only case where the
   * full-page warning is still shown automatically.
   */
  quietProtectionMode: boolean;
  /** When false, blocked/flagged events are not persisted to Event History
   * or the local statistics used for the badge/summary notification. */
  logBlockedEvents: boolean;
  /**
   * Internal, not user-editable directly: the profile that was active
   * immediately before a scheduled-protection window switched it. Used to
   * restore the user's own choice once the window ends. Only ever set/read
   * by the schedule-evaluation logic in src/background/index.ts.
   */
  preScheduleProfile?: ProtectionProfileId;
  /** Internal: id of the ScheduleRule currently in effect, if any. */
  activeScheduleId?: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  protectionEnabled: true,
  startProtectionAutomatically: true,
  showBadgeCounter: true,
  showSummaryNotifications: true,
  filterLevel: "balanced",
  categories: DEFAULT_CATEGORY_STATE,
  activeProfile: "balanced",
  theme: "system",
  reducedMotion: false,
  locale: "en",
  retention: "30d",
  closeSuspiciousTabsAutomatically: true,
  allowUserInitiatedPopups: true,
  blockSuspiciousRedirectChains: true,
  cloudReputationOptIn: false,
  quietProtectionMode: true,
  logBlockedEvents: true
};

export type SiteProtectionMode = "protected" | "paused" | "trusted";

export interface SiteSettings {
  /** Registrable domain, e.g. "example.com". Never a wildcard pattern. */
  domain: string;
  mode: SiteProtectionMode;
  categories: CategoryToggleState;
  lockdown: boolean;
  /**
   * epoch ms: paused until this specific time.
   * "restart": paused until the next chrome.runtime.onStartup (real browser
   * restart, not a service-worker suspend/wake) -- cleared there.
   * undefined: paused until manually re-enabled (persists indefinitely).
   */
  pausedUntil?: number | "restart";
  /** epoch ms when the site entry was created/trusted. */
  addedAt: number;
  notes?: string;
}

export type EventCategory =
  | "popup"
  | "redirect"
  | "ad"
  | "tracker"
  | "overlay"
  | "annoyance";

export type EventAction = "blocked" | "allowed" | "flagged";

export interface ScheduleRule {
  id: string;
  label: string;
  enabled: boolean;
  /** 0 = Sunday ... 6 = Saturday, per Date.prototype.getDay(). */
  daysOfWeek: number[];
  /** Minutes since local midnight, 0-1439. */
  startMinute: number;
  endMinute: number;
  profile: ProtectionProfileId;
}

/**
 * A Pro-only, user-authored network rule: block all requests to a specific
 * domain. Deliberately narrow (a plain registrable domain, not a regex or
 * arbitrary URL pattern, and no ability to inject or run any code) --
 * MV3's declarativeNetRequest has no mechanism for arbitrary scripting, and
 * ShieldGuard does not claim one.
 */
export interface CustomRule {
  id: string;
  /** Registrable domain to block, e.g. "annoying-ads.example". */
  domain: string;
  enabled: boolean;
  createdAt: number;
}

export interface ProtectionEvent {
  id: string;
  timestamp: number;
  domain: string;
  destinationUrl?: string;
  category: EventCategory;
  reasons: string[];
  riskScore?: number;
  action: EventAction;
  tabId?: number;
}

export interface RulesetDiagnostic {
  id: string;
  enabled: boolean;
  ruleCount: number | null; // null if the ruleset file couldn't be read
}

export interface ProtectionDiagnostics {
  version: string;
  manifestVersion: number;
  minimumChromeVersion: string;
  protectionEnabled: boolean;
  activeProfile: ProtectionProfileId;
  rulesets: RulesetDiagnostic[];
  dynamicSiteExceptionRuleCount: number;
  dynamicCustomRuleCount: number;
  lastProtectionEvent: { timestamp: number; category: EventCategory; domain: string } | null;
  storageBytesInUse: number;
  eventCount: number;
  siteCount: number;
  plan: SubscriptionPlan;
  warnings: string[];
}

export interface DailyStatistics {
  /** ISO date, e.g. "2026-08-22" */
  date: string;
  popups: number;
  ads: number;
  redirects: number;
  trackers: number;
  overlays: number;
  annoyances: number;
}

export type SubscriptionPlan = "free" | "pro";

export interface SubscriptionState {
  plan: SubscriptionPlan;
  status: "active" | "expired" | "none" | "trial";
  /** epoch ms, absent for free plan */
  renewsAt?: number;
  licenseKeyLast4?: string;
  activatedAt?: number;
}

export interface ProtectionProfile {
  id: ProtectionProfileId;
  name: string;
  description: string;
  filterLevel: FilterLevel;
  categories: CategoryToggleState;
  isPremium: boolean;
}

export interface FilterRuleMeta {
  category: ProtectionCategory;
  ruleCount: number;
  fileName: string;
}

/** Runtime-only (non-persisted) signal used by the gesture/popup heuristics. */
export interface GestureSignal {
  tabId: number;
  timestamp: number;
  targetOrigin: string;
}

export interface BrokenSiteReport {
  id: string;
  timestamp: number;
  domain: string;
  problem:
    | "popup_blocked_incorrectly"
    | "ad_incorrectly_removed"
    | "website_broken"
    | "redirect_incorrectly_blocked"
    | "other";
  description: string;
}

/** Message contract between popup/dashboard/content <-> background service worker. */
export type RuntimeMessage =
  | { type: "GET_TAB_STATE"; tabId: number }
  | { type: "GET_CURRENT_TAB_STATE" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<UserSettings> }
  | { type: "GET_SITE_SETTINGS"; domain: string }
  | { type: "GET_ALL_SITES" }
  | { type: "ALLOW_REDIRECT_ONCE"; tabId: number; url: string }
  | { type: "SET_SITE_SETTINGS"; site: SiteSettings }
  | { type: "PAUSE_SITE"; domain: string; durationMs: number | "manual" | "restart" }
  | { type: "TRUST_SITE"; domain: string }
  | { type: "RESET_SITE"; domain: string }
  | { type: "GET_STATISTICS"; range: "today" | "yesterday" | "7d" | "30d" | "all" }
  | { type: "GET_EVENTS"; filter?: EventCategory | "all"; search?: string; limit?: number }
  | { type: "CLEAR_EVENTS" }
  | { type: "EVENT_DECISION"; eventId: string; decision: "allow_once" | "trust_domain" | "keep_blocking" }
  | { type: "GET_SUBSCRIPTION" }
  | { type: "ACTIVATE_LICENSE"; key: string }
  | { type: "REFRESH_SUBSCRIPTION" }
  | { type: "LOGOUT" }
  | { type: "SET_PROFILE"; profile: ProtectionProfileId }
  | { type: "REPORT_BROKEN_SITE"; report: Omit<BrokenSiteReport, "id" | "timestamp"> }
  | { type: "EXPORT_SETTINGS" }
  | { type: "IMPORT_SETTINGS"; payload: string }
  | { type: "RESET_EXTENSION" }
  | { type: "COSMETIC_OVERLAY_REMOVED"; domain: string; reason: string }
  | { type: "POPUP_GESTURE"; targetOrigin: string }
  | { type: "GET_DIAGNOSTICS" }
  | { type: "GET_SCHEDULES" }
  | { type: "SET_SCHEDULES"; schedules: ScheduleRule[] }
  | { type: "GET_CUSTOM_RULES" }
  | { type: "SET_CUSTOM_RULES"; rules: CustomRule[] };
