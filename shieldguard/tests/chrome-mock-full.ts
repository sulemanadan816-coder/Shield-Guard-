import { vi } from "vitest";
import { installChromeStorageMock } from "./chrome-mock";
import type { RuntimeMessage } from "../src/lib/types";

/**
 * Installs a chrome.* mock sufficient to boot dashboard.ts under jsdom.
 * chrome.runtime.sendMessage is backed by the REAL storage/statistics/
 * subscription/profiles modules (same code the background service worker
 * uses) so this test exercises actual behavior, not a hand-rolled fixture.
 */
export async function installFullChromeMock(): Promise<void> {
  installChromeStorageMock();

  const storage = await import("../src/lib/storage");
  const statistics = await import("../src/lib/statistics");
  const subscription = await import("../src/lib/subscription");
  const rulesMeta = await import("../src/lib/rules-meta");
  void rulesMeta; // exercised indirectly via fetch mock below

  const chromeGlobal = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;

  async function handle(message: RuntimeMessage): Promise<unknown> {
    switch (message.type) {
      case "GET_SETTINGS":
        return storage.getSettings();
      case "SET_SETTINGS":
        return storage.setSettings(message.settings);
      case "GET_SITE_SETTINGS":
        return storage.getSiteSettings(message.domain);
      case "GET_ALL_SITES":
        return storage.getAllSiteSettings();
      case "SET_SITE_SETTINGS":
        await storage.setSiteSettings(message.site);
        return { ok: true };
      case "TRUST_SITE": {
        const existing = await storage.getSiteSettings(message.domain);
        const settings = await storage.getSettings();
        await storage.setSiteSettings(
          existing
            ? { ...existing, mode: "trusted" }
            : {
                domain: message.domain,
                mode: "trusted",
                categories: settings.categories,
                lockdown: false,
                addedAt: Date.now()
              }
        );
        return { ok: true };
      }
      case "PAUSE_SITE":
      case "RESET_SITE":
        return { ok: true };
      case "GET_STATISTICS":
        return statistics.getStatisticsForRange(message.range);
      case "GET_EVENTS":
        return storage.getEvents();
      case "CLEAR_EVENTS":
        await storage.clearEvents();
        return { ok: true };
      case "EVENT_DECISION":
        return { ok: true };
      case "GET_TAB_STATE": {
        const settings = await storage.getSettings();
        return { domain: "example.com", settings, site: undefined, protectedNow: true };
      }
      case "GET_SUBSCRIPTION": {
        const premium = await subscription.isPremium();
        const sub = await storage.getSubscription();
        return { premium, subscription: sub };
      }
      case "ACTIVATE_LICENSE":
        return subscription.activateLicense(message.key);
      case "REFRESH_SUBSCRIPTION":
        return subscription.refreshSubscription();
      case "LOGOUT":
        return subscription.logout();
      case "SET_PROFILE": {
        return storage.setSettings({ activeProfile: message.profile });
      }
      case "GET_SCHEDULES":
        return storage.getSchedules();
      case "SET_SCHEDULES":
        await storage.setSchedules(message.schedules);
        return { ok: true };
      case "GET_CUSTOM_RULES":
        return storage.getCustomRules();
      case "SET_CUSTOM_RULES":
        await storage.setCustomRules(message.rules);
        return { ok: true };
      case "REPORT_BROKEN_SITE":
        return { ok: true };
      case "EXPORT_SETTINGS":
        return storage.exportAll();
      case "IMPORT_SETTINGS":
        await storage.importAll(message.payload);
        return { ok: true };
      case "RESET_EXTENSION":
        await storage.resetExtension();
        return { ok: true };
      default:
        return { ok: true };
    }
  }

  chromeGlobal.runtime = {
    // Mirror production's background/index.ts behavior: a thrown error in a
    // handler must resolve to { error: message }, not reject the sendMessage
    // promise -- chrome.runtime.sendMessage only rejects on a transport
    // failure (e.g. no listener), never because the responder's payload
    // happens to contain an "error" field. Getting this wrong here would
    // make dashboard.ts code that correctly relies on the real behavior
    // (checking response.error, not try/catch) behave differently under test.
    sendMessage: (message: RuntimeMessage) =>
      handle(message).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) })),
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    getManifest: () => ({ version: "0.1.0-test" }),
    openOptionsPage: vi.fn()
  };

  chromeGlobal.tabs = {
    query: async () => [{ id: 1, url: "https://example.com/" }],
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    onRemoved: { addListener: vi.fn() }
  };

  // rules-meta.ts fetches chrome.runtime.getURL(`rules/${file}`); return
  // small fixture arrays/objects matching the real rule file shapes.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("annoyances.json")) {
      return new Response(JSON.stringify({ keywordSelectors: ["a", "b"], protectedSelectors: ["form"] }));
    }
    return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]));
  }) as typeof fetch;
  void originalFetch;

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn() },
    configurable: true
  });
}
