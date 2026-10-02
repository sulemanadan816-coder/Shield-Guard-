import type { ProtectionProfile } from "./types";

export const PROTECTION_PROFILES: ProtectionProfile[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Solid protection for everyday browsing.",
    filterLevel: "balanced",
    isPremium: false,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: true,
      annoyances: true,
      socialWidgets: false,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: true
    }
  },
  {
    id: "streaming",
    name: "Streaming",
    description: "Extra popup and overlay protection for video/streaming sites.",
    filterLevel: "strict",
    isPremium: true,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: true,
      annoyances: true,
      socialWidgets: true,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: true
    }
  },
  {
    id: "downloading",
    name: "Downloading",
    description: "Aggressive redirect and fake-download-overlay protection.",
    filterLevel: "strict",
    isPremium: true,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: false,
      annoyances: true,
      socialWidgets: false,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: true
    }
  },
  {
    id: "privacy",
    name: "Privacy",
    description: "Maximum tracker blocking for privacy-focused browsing.",
    filterLevel: "strict",
    isPremium: true,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: true,
      annoyances: true,
      socialWidgets: true,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: false
    }
  },
  {
    id: "lockdown",
    name: "Lockdown",
    description: "Maximum protection. May cause some websites to malfunction.",
    filterLevel: "lockdown",
    isPremium: true,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: true,
      annoyances: true,
      socialWidgets: true,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: true
    }
  },
  {
    id: "custom",
    name: "Custom",
    description: "Your own configuration of individual protection categories.",
    filterLevel: "custom",
    isPremium: false,
    categories: {
      popups: true,
      redirects: true,
      ads: true,
      trackers: true,
      annoyances: true,
      socialWidgets: false,
      cryptoMining: true,
      scamMalvertising: true,
      overlays: true
    }
  }
];

export function getProfile(id: string): ProtectionProfile | undefined {
  return PROTECTION_PROFILES.find((p) => p.id === id);
}
