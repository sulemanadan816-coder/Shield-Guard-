/**
 * Conservative cosmetic filtering for intrusive overlays (fake download
 * prompts, popup overlays, forced interstitials). Requires BOTH:
 *   1. a keyword/class/id match from rules/annoyances.json, AND
 *   2. a structural signal (fixed/sticky positioning covering a large
 *      share of the viewport, elevated z-index)
 * and skips anything that contains a "protected" element (forms, login,
 * checkout, video/player, nav, cookie/consent UI, comments, article/main
 * content) so legitimate UI is never touched.
 */
import type { RuntimeMessage } from "../lib/types";

interface AnnoyanceConfig {
  keywordSelectors: string[];
  protectedSelectors: string[];
}

let config: AnnoyanceConfig | null = null;
let overlaysEnabled = true;
let annoyancesEnabled = true;
const handled = new WeakSet<Element>();

async function loadConfig(): Promise<AnnoyanceConfig> {
  const res = await fetch(chrome.runtime.getURL("rules/annoyances.json"));
  return (await res.json()) as AnnoyanceConfig;
}

async function loadSiteState(): Promise<void> {
  try {
    const tabState = (await chrome.runtime.sendMessage({
      type: "GET_CURRENT_TAB_STATE"
    } as RuntimeMessage)) as { settings?: { categories?: { overlays: boolean; annoyances: boolean } } } | undefined;
    const categories = tabState?.settings?.categories;
    if (categories) {
      overlaysEnabled = categories.overlays;
      annoyancesEnabled = categories.annoyances;
    }
  } catch {
    // Best-effort; default to enabled.
  }
}

function isLargeViewportOverlay(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const position = style.position;
  if (position !== "fixed" && position !== "sticky") return false;

  const zIndex = Number.parseInt(style.zIndex || "0", 10);
  if (Number.isNaN(zIndex) || zIndex < 999) return false;

  const rect = el.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea === 0) return false;
  const overlayArea = Math.max(0, rect.width) * Math.max(0, rect.height);
  return overlayArea / viewportArea >= 0.4;
}

function containsProtectedContent(el: Element, protectedSelectors: string[]): boolean {
  return protectedSelectors.some((sel) => {
    try {
      return el.matches(sel) || el.querySelector(sel) !== null;
    } catch {
      return false;
    }
  });
}

function reportRemoval(reason: string): void {
  const message: RuntimeMessage = {
    type: "COSMETIC_OVERLAY_REMOVED",
    domain: location.hostname,
    reason
  };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function scan(): void {
  if (!config) return;
  if (!overlaysEnabled && !annoyancesEnabled) return;

  for (const selector of config.keywordSelectors) {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of Array.from(matches)) {
      if (handled.has(el)) continue;
      if (containsProtectedContent(el, config.protectedSelectors)) continue;
      if (!isLargeViewportOverlay(el)) continue;

      handled.add(el);
      (el as HTMLElement).style.setProperty("display", "none", "important");
      document.body.style.removeProperty("overflow"); // undo common "no-scroll" lock pattern
      reportRemoval(`Matched selector "${selector}" with full-viewport fixed/sticky positioning`);
    }
  }
}

const throttledScan = (() => {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  };
})();

async function init(): Promise<void> {
  await loadSiteState();
  if (!overlaysEnabled && !annoyancesEnabled) return;
  config = await loadConfig();
  scan();

  const observer = new MutationObserver(() => throttledScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
