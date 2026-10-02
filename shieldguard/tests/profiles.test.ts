import { describe, it, expect } from "vitest";
import { PROTECTION_PROFILES, getProfile } from "../src/lib/profiles";

describe("protection profiles", () => {
  it("includes exactly the documented profile set", () => {
    const ids = PROTECTION_PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual(["balanced", "custom", "downloading", "lockdown", "privacy", "streaming"].sort());
  });

  it("balanced and custom are free; the rest are premium", () => {
    const free = PROTECTION_PROFILES.filter((p) => !p.isPremium).map((p) => p.id).sort();
    expect(free).toEqual(["balanced", "custom"].sort());
  });

  it("lockdown enables every protection category", () => {
    const lockdown = getProfile("lockdown");
    expect(lockdown).toBeDefined();
    for (const value of Object.values(lockdown!.categories)) {
      expect(value).toBe(true);
    }
  });

  it("returns undefined for an unknown profile id", () => {
    expect(getProfile("not-a-real-profile")).toBeUndefined();
  });
});
