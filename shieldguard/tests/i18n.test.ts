import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { t } from "../src/lib/i18n";

describe("i18n helper", () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("falls back to the provided English string when chrome.i18n is unavailable", () => {
    expect(t("someKey", "Fallback Text")).toBe("Fallback Text");
  });

  it("falls back when chrome.i18n.getMessage returns an empty string", () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      i18n: { getMessage: () => "" }
    };
    expect(t("missingKey", "Fallback Text")).toBe("Fallback Text");
  });

  it("returns the translated message when available", () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      i18n: { getMessage: (key: string) => (key === "greeting" ? "Bonjour" : "") }
    };
    expect(t("greeting", "Hello")).toBe("Bonjour");
  });

  it("never throws even if chrome.i18n.getMessage itself throws", () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      i18n: {
        getMessage: () => {
          throw new Error("boom");
        }
      }
    };
    expect(() => t("anyKey", "Safe Fallback")).not.toThrow();
    expect(t("anyKey", "Safe Fallback")).toBe("Safe Fallback");
  });
});

describe("locale file parity", () => {
  const localesDir = join(__dirname, "..", "public", "_locales");
  const locales = readdirSync(localesDir);

  it("ships more than one locale", () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  it("every locale defines exactly the same set of message keys as English", () => {
    const enKeys = Object.keys(
      JSON.parse(readFileSync(join(localesDir, "en", "messages.json"), "utf-8"))
    ).sort();

    for (const locale of locales) {
      const keys = Object.keys(
        JSON.parse(readFileSync(join(localesDir, locale, "messages.json"), "utf-8"))
      ).sort();
      expect(keys, `locale "${locale}" key set should match en`).toEqual(enKeys);
    }
  });

  it("every message value is non-empty", () => {
    for (const locale of locales) {
      const messages = JSON.parse(readFileSync(join(localesDir, locale, "messages.json"), "utf-8")) as Record<
        string,
        { message: string }
      >;
      for (const [key, entry] of Object.entries(messages)) {
        expect(entry.message.length, `${locale}/${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});
