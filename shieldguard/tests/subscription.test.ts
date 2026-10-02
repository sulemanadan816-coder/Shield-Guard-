import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStorageMock } from "./chrome-mock";

installChromeStorageMock();

const { resetExtension } = await import("../src/lib/storage");
const { isPremium, activateLicense, logout } = await import("../src/lib/subscription");

describe("subscription / license architecture", () => {
  beforeEach(async () => {
    await resetExtension();
  });

  it("starts on the free plan with no entitlement", async () => {
    expect(await isPremium()).toBe(false);
  });

  it("rejects an invalid license key rather than granting access", async () => {
    await expect(activateLicense("not-a-real-key")).rejects.toThrow();
    expect(await isPremium()).toBe(false);
  });

  it("rejects an empty license key", async () => {
    await expect(activateLicense("")).rejects.toThrow();
  });

  it("grants entitlement only for a well-formed development test key", async () => {
    const sub = await activateLicense("SG-TEST-ABCD-1234");
    expect(sub.plan).toBe("pro");
    expect(sub.status).toBe("active");
    expect(await isPremium()).toBe(true);
  });

  it("logout returns to the free plan", async () => {
    await activateLicense("SG-TEST-ABCD-1234");
    expect(await isPremium()).toBe(true);
    await logout();
    expect(await isPremium()).toBe(false);
  });
});
