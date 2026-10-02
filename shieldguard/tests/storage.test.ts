import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStorageMock } from "./chrome-mock";

// The chrome mock must be installed before importing modules that call
// chrome.storage.local at module scope evaluation time is avoided here,
// but to be safe we install before each test and re-import fresh state
// via dynamic import per test file run (vitest isolates test files).
installChromeStorageMock();

const {
  getSettings,
  setSettings,
  getSiteSettings,
  setSiteSettings,
  getAllSiteSettings,
  normalizeDomain,
  appendEvent,
  getEvents,
  MAX_STORED_EVENTS,
  resetExtension,
  importAll,
  exportAll
} = await import("../src/lib/storage");

import { DEFAULT_SETTINGS } from "../src/lib/types";
import type { ProtectionEvent, SiteSettings } from "../src/lib/types";
import { ExpectedError } from "../src/lib/errors";

describe("storage: settings", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("returns defaults when nothing has been stored", async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial updates without dropping other fields", async () => {
    await setSettings({ protectionEnabled: false });
    const settings = await getSettings();
    expect(settings.protectionEnabled).toBe(false);
    expect(settings.filterLevel).toBe(DEFAULT_SETTINGS.filterLevel);
  });

  it("merges category updates instead of replacing the whole category object", async () => {
    await setSettings({ categories: { ...DEFAULT_SETTINGS.categories, ads: false } });
    const settings = await getSettings();
    expect(settings.categories.ads).toBe(false);
    expect(settings.categories.trackers).toBe(true);
  });
});

describe("storage: site settings / trusted sites", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("normalizes domains by stripping www and lowercasing", () => {
    expect(normalizeDomain("WWW.Example.COM")).toBe("example.com");
  });

  it("stores and retrieves a site entry", async () => {
    const site: SiteSettings = {
      domain: "example.com",
      mode: "trusted",
      categories: DEFAULT_SETTINGS.categories,
      lockdown: false,
      addedAt: Date.now()
    };
    await setSiteSettings(site);
    const retrieved = await getSiteSettings("example.com");
    expect(retrieved?.mode).toBe("trusted");
  });

  it("never lets a trust decision leak to an unrelated domain", async () => {
    await setSiteSettings({
      domain: "example.com",
      mode: "trusted",
      categories: DEFAULT_SETTINGS.categories,
      lockdown: false,
      addedAt: Date.now()
    });
    const unrelated = await getSiteSettings("notexample.com");
    expect(unrelated).toBeUndefined();
    const evilLookalike = await getSiteSettings("example.com.evil.net");
    expect(evilLookalike).toBeUndefined();
  });

  it("keeps subdomain entries distinct from the parent domain", async () => {
    await setSiteSettings({
      domain: "example.com",
      mode: "protected",
      categories: DEFAULT_SETTINGS.categories,
      lockdown: false,
      addedAt: Date.now()
    });
    await setSiteSettings({
      domain: "sub.example.com",
      mode: "trusted",
      categories: DEFAULT_SETTINGS.categories,
      lockdown: false,
      addedAt: Date.now()
    });
    const all = await getAllSiteSettings();
    expect(all["example.com"]?.mode).toBe("protected");
    expect(all["sub.example.com"]?.mode).toBe("trusted");
  });
});

describe("storage: events", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("appends events and returns them", async () => {
    const event: ProtectionEvent = {
      id: "1",
      timestamp: Date.now(),
      domain: "example.com",
      category: "ad",
      reasons: ["test"],
      action: "blocked"
    };
    await appendEvent(event);
    const events = await getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.domain).toBe("example.com");
  });

  it("caps stored events at MAX_STORED_EVENTS", async () => {
    for (let i = 0; i < MAX_STORED_EVENTS + 25; i++) {
      await appendEvent({
        id: String(i),
        timestamp: Date.now(),
        domain: "example.com",
        category: "ad",
        reasons: [],
        action: "blocked"
      });
    }
    const events = await getEvents();
    expect(events.length).toBe(MAX_STORED_EVENTS);
    // Oldest entries should have been trimmed, newest kept.
    expect(events[events.length - 1]?.id).toBe(String(MAX_STORED_EVENTS + 24));
  });
});

describe("storage: importAll validation", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("round-trips a real export through importAll without error", async () => {
    await setSettings({ filterLevel: "strict" });
    const exported = await exportAll();
    await resetExtension();
    await importAll(exported);
    const settings = await getSettings();
    expect(settings.filterLevel).toBe("strict");
  });

  it("rejects malformed JSON with a friendly ExpectedError, not a raw SyntaxError", async () => {
    await expect(importAll("{ not valid json")).rejects.toThrow(ExpectedError);
  });

  it("rejects valid JSON that isn't a settings export shape (e.g. a bare array)", async () => {
    await expect(importAll("[1,2,3]")).rejects.toThrow(ExpectedError);
  });

  it("rejects a malformed settings section", async () => {
    await expect(importAll(JSON.stringify({ settings: "not-an-object" }))).rejects.toThrow(ExpectedError);
  });
});
