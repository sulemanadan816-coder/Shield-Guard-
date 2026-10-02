/**
 * Tracks per-tab navigation chains (via webNavigation.onBeforeNavigate /
 * onCommitted) to detect suspicious redirect sequences: many domain
 * changes in a short time, unrelated to the page the user actually
 * requested.
 */
import { getRegistrableDomain, getHostname } from "./url-utils";

export interface ChainHop {
  url: string;
  domain: string;
  timestamp: number;
}

export type RedirectSeverity = "low" | "medium" | "high";

export interface RedirectAnalysis {
  chain: ChainHop[];
  distinctDomains: number;
  averageHopMs: number | null;
  suspicious: boolean;
  /**
   * "high" is reserved for chains that show a same-domain navigation loop
   * (A -> B -> A) or an unusually large number of distinct domains in the
   * tracking window -- the cases where a full-page interstitial is still
   * justified when Quiet Protection Mode is turned off. "medium"/"low"
   * chains are always handled silently regardless of that setting.
   */
  severity: RedirectSeverity;
  looping: boolean;
  reasons: string[];
}

const CHAIN_WINDOW_MS = 8_000;
const FAST_HOP_MS = 700;
const MAX_TRACKED_HOPS = 12;
const HIGH_SEVERITY_DOMAIN_COUNT = 5;

export class RedirectTracker {
  private chains = new Map<number, ChainHop[]>();

  recordNavigation(tabId: number, url: string): ChainHop[] {
    const domain = getHostname(url);
    if (!domain) return this.chains.get(tabId) ?? [];
    const now = Date.now();
    const existing = (this.chains.get(tabId) ?? []).filter(
      (hop) => now - hop.timestamp < CHAIN_WINDOW_MS
    );
    existing.push({ url, domain: getRegistrableDomain(domain), timestamp: now });
    const trimmed = existing.slice(-MAX_TRACKED_HOPS);
    this.chains.set(tabId, trimmed);
    return trimmed;
  }

  getChain(tabId: number): ChainHop[] {
    return this.chains.get(tabId) ?? [];
  }

  /** The earliest still-tracked URL for this tab, i.e. the page the user
   * was actually on before the current redirect sequence began. Used as
   * the "safe previous destination" to divert back to instead of the
   * flagged destination -- never the destination itself, never a blind
   * history.back(). */
  earliestKnownGoodUrl(tabId: number): string | null {
    const chain = this.getChain(tabId);
    return chain.length > 0 ? chain[0]!.url : null;
  }

  clearTab(tabId: number): void {
    this.chains.delete(tabId);
  }

  analyze(tabId: number): RedirectAnalysis {
    const chain = this.getChain(tabId);
    const distinctDomains = new Set(chain.map((h) => h.domain)).size;

    let averageHopMs: number | null = null;
    if (chain.length >= 2) {
      const first = chain[0];
      const last = chain[chain.length - 1];
      if (first && last) {
        const total = last.timestamp - first.timestamp;
        averageHopMs = total / (chain.length - 1);
      }
    }

    const reasons: string[] = [];
    let suspicious = false;

    if (distinctDomains >= 3) {
      suspicious = true;
      reasons.push(`Navigation crossed ${distinctDomains} different domains rapidly`);
    }
    if (averageHopMs !== null && averageHopMs < FAST_HOP_MS && chain.length >= 3 && distinctDomains >= 2) {
      suspicious = true;
      reasons.push("Redirect hops occurred faster than a human-driven navigation");
    }

    // Loop detection: the same domain reappearing non-adjacently (A -> B -> A)
    // is a strong, distinct signal from "many domains" -- it indicates a
    // redirect script bouncing the tab rather than a normal multi-hop chain,
    // and it's also the case our diversion logic must be careful not to
    // itself reproduce.
    // Loop detection: the same domain reappearing *after the tab actually
    // left it for a different domain* (A -> B -> A) is a strong, distinct
    // signal from "many domains" -- it indicates a redirect script bouncing
    // the tab rather than a normal multi-hop chain. This must NOT fire for
    // ordinary repeated navigation within one domain (page1 -> page2 ->
    // page3 on the same site is not a loop) -- the check below explicitly
    // requires a *different* domain to appear strictly between the two
    // occurrences, not just index distance.
    let looping = false;
    const lastIndexOfDomain = new Map<string, number>();
    chain.forEach((hop, idx) => {
      const prevIdx = lastIndexOfDomain.get(hop.domain);
      if (prevIdx !== undefined) {
        const wentAwayInBetween = chain.slice(prevIdx + 1, idx).some((h) => h.domain !== hop.domain);
        if (wentAwayInBetween) looping = true;
      }
      lastIndexOfDomain.set(hop.domain, idx);
    });
    if (looping) {
      suspicious = true;
      reasons.push("Tab is bouncing between the same domains in a loop");
    }

    const severity: RedirectSeverity =
      looping || distinctDomains >= HIGH_SEVERITY_DOMAIN_COUNT
        ? "high"
        : suspicious
          ? "medium"
          : "low";

    return { chain, distinctDomains, averageHopMs, suspicious, severity, looping, reasons };
  }
}

export const redirectTracker = new RedirectTracker();
