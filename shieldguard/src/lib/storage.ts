/**
 * Thin, strongly-typed wrapper around chrome.storage.local.
 * All persisted ShieldGuard data goes through this module so the schema
 * stays in one place and is easy to reason about / test.
 */
import {
  DEFAULT_SETTINGS,
  DEFAULT_CATEGORY_STATE,
  type UserSettings,
  type SiteSettings,
  type ProtectionEvent,
  type DailyStatistics,
  type SubscriptionState,
  type BrokenSiteReport,
  type ScheduleRule,
  type CustomRule
} from "./types";
import { ExpectedError } from "./errors";

const KEYS = {
  settings: "sg_settings",
  sites: "sg_sites", // Record<domain, SiteSettings>
  events: "sg_events", // ProtectionEvent[]
  stats: "sg_stats", // Record<isoDate, DailyStatistics>
  subscription: "sg_subscription",
  reports: "sg_reports", // BrokenSiteReport[]
  schedules: "sg_schedules", // ScheduleRule[]
  customRules: "sg_custom_rules" // CustomRule[]
} as const;

/** Cap on stored events; older entries are trimmed by the retention job. */
export const MAX_STORED_EVENTS = 5000;

type StorageArea = chrome.storage.StorageArea;

function area(): StorageArea {
  return chrome.storage.local;
}

async function get<T>(key: string, fallback: T): Promise<T> {
  const result = await area().get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await area().set({ [key]: value });
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await get<Partial<UserSettings>>(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    categories: { ...DEFAULT_CATEGORY_STATE, ...(stored.categories ?? {}) }
  };
}

export async function setSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const merged: UserSettings = {
    ...current,
    ...patch,
    categories: { ...current.categories, ...(patch.categories ?? {}) }
  };
  await set(KEYS.settings, merged);
  return merged;
}

export async function getAllSiteSettings(): Promise<Record<string, SiteSettings>> {
  return get<Record<string, SiteSettings>>(KEYS.sites, {});
}

export async function getSiteSettings(domain: string): Promise<SiteSettings | undefined> {
  const all = await getAllSiteSettings();
  return all[normalizeDomain(domain)];
}

export async function setSiteSettings(site: SiteSettings): Promise<void> {
  const all = await getAllSiteSettings();
  const domain = normalizeDomain(site.domain);
  all[domain] = { ...site, domain };
  await set(KEYS.sites, all);
}

export async function removeSiteSettings(domain: string): Promise<void> {
  const all = await getAllSiteSettings();
  delete all[normalizeDomain(domain)];
  await set(KEYS.sites, all);
}

/**
 * Normalizes a hostname to its registrable form for storage/lookup purposes.
 * This intentionally does NOT strip subdomains -- "sub.example.com" and
 * "example.com" are treated as distinct entries so a trust decision never
 * silently widens to unrelated domains. Callers that want eTLD+1 rollups
 * should use getRegistrableDomain() from url-utils.ts explicitly.
 */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^www\./, "");
}

export async function appendEvent(event: ProtectionEvent): Promise<void> {
  const events = await get<ProtectionEvent[]>(KEYS.events, []);
  events.push(event);
  if (events.length > MAX_STORED_EVENTS) {
    events.splice(0, events.length - MAX_STORED_EVENTS);
  }
  await set(KEYS.events, events);
}

export async function getEvents(): Promise<ProtectionEvent[]> {
  return get<ProtectionEvent[]>(KEYS.events, []);
}

export async function replaceEvents(events: ProtectionEvent[]): Promise<void> {
  await set(KEYS.events, events);
}

export async function clearEvents(): Promise<void> {
  await set(KEYS.events, []);
}

export async function getStatsMap(): Promise<Record<string, DailyStatistics>> {
  return get<Record<string, DailyStatistics>>(KEYS.stats, {});
}

export async function setStatsMap(stats: Record<string, DailyStatistics>): Promise<void> {
  await set(KEYS.stats, stats);
}

export async function getSubscription(): Promise<SubscriptionState> {
  return get<SubscriptionState>(KEYS.subscription, { plan: "free", status: "none" });
}

export async function setSubscription(sub: SubscriptionState): Promise<void> {
  await set(KEYS.subscription, sub);
}

export async function getReports(): Promise<BrokenSiteReport[]> {
  return get<BrokenSiteReport[]>(KEYS.reports, []);
}

export async function appendReport(report: BrokenSiteReport): Promise<void> {
  const reports = await getReports();
  reports.push(report);
  await set(KEYS.reports, reports);
}

export async function getSchedules(): Promise<ScheduleRule[]> {
  return get<ScheduleRule[]>(KEYS.schedules, []);
}

export async function setSchedules(schedules: ScheduleRule[]): Promise<void> {
  await set(KEYS.schedules, schedules);
}

export async function getCustomRules(): Promise<CustomRule[]> {
  return get<CustomRule[]>(KEYS.customRules, []);
}

export async function setCustomRules(rules: CustomRule[]): Promise<void> {
  await set(KEYS.customRules, rules);
}

export async function exportAll(): Promise<string> {
  const [settings, sites, subscription] = await Promise.all([
    getSettings(),
    getAllSiteSettings(),
    getSubscription()
  ]);
  return JSON.stringify(
    { version: 1, exportedAt: Date.now(), settings, sites, subscription },
    null,
    2
  );
}

export async function importAll(payload: string): Promise<void> {
  let parsed: { settings?: Partial<UserSettings>; sites?: Record<string, SiteSettings> };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    throw new ExpectedError("That file isn't valid JSON, so it can't be imported as ShieldGuard settings.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ExpectedError("That file doesn't look like a ShieldGuard settings export.");
  }
  if (parsed.settings !== undefined && (typeof parsed.settings !== "object" || parsed.settings === null)) {
    throw new ExpectedError("That file's settings section is malformed.");
  }
  if (parsed.sites !== undefined && (typeof parsed.sites !== "object" || parsed.sites === null)) {
    throw new ExpectedError("That file's site list is malformed.");
  }
  if (parsed.settings) await setSettings(parsed.settings);
  if (parsed.sites) await set(KEYS.sites, parsed.sites);
}

export async function resetExtension(): Promise<void> {
  await area().clear();
  await set(KEYS.settings, DEFAULT_SETTINGS);
}
