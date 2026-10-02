import type { SubscriptionState } from "./types";
import { getSubscription, setSubscription } from "./storage";
import { ExpectedError } from "./errors";

export interface SubscriptionProvider {
  /** Validates a license key against the licensing backend. */
  activateLicense(key: string): Promise<SubscriptionState>;
  /** Re-checks current entitlement status (e.g. renewal, cancellation). */
  refreshSubscription(current: SubscriptionState): Promise<SubscriptionState>;
  logout(): Promise<SubscriptionState>;
}

/**
 * Development/test provider. Does NOT fabricate a successful purchase --
 * it only validates against an obviously-fake format so automated tests
 * and local development can exercise the Pro UI without a real backend.
 * A real Chrome Web Store submission MUST swap this for
 * ProductionSubscriptionProvider backed by a real licensing API
 * (e.g. Chrome Web Store payments or an external billing provider).
 */
export class MockSubscriptionProvider implements SubscriptionProvider {
  async activateLicense(key: string): Promise<SubscriptionState> {
    const trimmed = key.trim();
    const isPlausibleTestKey = /^SG-TEST-[A-Z0-9]{4,}-[A-Z0-9]{4,}$/.test(trimmed);
    if (!isPlausibleTestKey) {
      throw new ExpectedError(
        "Invalid license key. (Development build: expected format SG-TEST-XXXX-XXXX.)"
      );
    }
    return {
      plan: "pro",
      status: "active",
      renewsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      licenseKeyLast4: trimmed.slice(-4),
      activatedAt: Date.now()
    };
  }

  async refreshSubscription(current: SubscriptionState): Promise<SubscriptionState> {
    // No real backend in development: return current state unchanged
    // rather than pretending to confirm anything with a server.
    return current;
  }

  async logout(): Promise<SubscriptionState> {
    return { plan: "free", status: "none" };
  }
}

/**
 * Production provider stub. This intentionally throws until wired to a
 * real licensing/billing backend -- ShieldGuard must never claim a
 * successful purchase or entitlement without verifying it against a real
 * service. Fill in `apiBaseUrl` and the fetch calls when a backend exists.
 */
export class ProductionSubscriptionProvider implements SubscriptionProvider {
  constructor(private readonly apiBaseUrl: string) {}

  async activateLicense(_key: string): Promise<SubscriptionState> {
    throw new Error(
      "ShieldGuard Pro licensing backend is not yet configured. " +
        "No purchase can be validated in this build."
    );
  }

  async refreshSubscription(current: SubscriptionState): Promise<SubscriptionState> {
    return current;
  }

  async logout(): Promise<SubscriptionState> {
    return { plan: "free", status: "none" };
  }
}

// Swap this line to ProductionSubscriptionProvider (with a real API base
// URL) before a Chrome Web Store submission with real payments enabled.
const provider: SubscriptionProvider = new MockSubscriptionProvider();

export async function isPremium(): Promise<boolean> {
  const sub = await getSubscription();
  return sub.plan === "pro" && sub.status === "active";
}

export async function activateLicense(key: string): Promise<SubscriptionState> {
  const sub = await provider.activateLicense(key);
  await setSubscription(sub);
  return sub;
}

export async function refreshSubscription(): Promise<SubscriptionState> {
  const current = await getSubscription();
  const refreshed = await provider.refreshSubscription(current);
  await setSubscription(refreshed);
  return refreshed;
}

export async function logout(): Promise<SubscriptionState> {
  const sub = await provider.logout();
  await setSubscription(sub);
  return sub;
}
