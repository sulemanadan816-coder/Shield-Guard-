/**
 * Popup Risk Score heuristic.
 *
 * IMPORTANT: this is a heuristic signal, not a guaranteed malware/threat
 * probability. It combines several legitimately observable signals to
 * decide whether a newly created tab/window looks like unwanted popup
 * abuse versus a normal user-initiated action (OAuth login, "open in new
 * tab" link, etc).
 */
import { isCrossOrigin } from "./url-utils";

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface PopupSignalInput {
  /** ms since the most recent trusted user gesture (click/keypress) in the opener tab. */
  msSinceLastGesture: number | null;
  /** Origin of the tab/frame that opened the popup. */
  openerOrigin: string;
  /** Destination URL the popup is navigating/navigated to. */
  destinationUrl: string;
  /** How many popups this opener has produced in the last 10s window. */
  recentPopupCountFromOpener: number;
  /** True if destination matches a known advertising/popup filter rule. */
  matchesKnownAdRule: boolean;
  /** True if destination matches a known scam/malvertising rule. */
  matchesScamRule: boolean;
  /** True if the new tab/window was created without becoming the active tab (pop-under pattern). */
  openedInBackground: boolean;
  /** Number of distinct domains in the navigation chain leading here, if known. */
  redirectChainLength: number;
}

export interface PopupRiskResult {
  score: number; // 0-100
  tier: RiskTier;
  reasons: string[];
}

const GESTURE_WINDOW_MS = 1500;

export function tierForScore(score: number): RiskTier {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function scorePopup(input: PopupSignalInput): PopupRiskResult {
  let score = 0;
  const reasons: string[] = [];

  const hasRecentGesture =
    input.msSinceLastGesture !== null && input.msSinceLastGesture <= GESTURE_WINDOW_MS;

  if (!hasRecentGesture) {
    score += 35;
    reasons.push("No recent user click before this tab/window was created");
  }

  const crossOrigin = isCrossOrigin(input.openerOrigin, input.destinationUrl);
  if (crossOrigin) {
    score += 15;
    reasons.push("Destination is on a different domain than the opener");
  }

  if (input.matchesKnownAdRule) {
    score += 25;
    reasons.push("Destination matches a known advertising/popup pattern");
  }

  if (input.matchesScamRule) {
    score += 30;
    reasons.push("Destination matches a known scam/malvertising pattern");
  }

  if (input.recentPopupCountFromOpener >= 3) {
    score += 20;
    reasons.push("Rapid sequence of popups from the same page");
  } else if (input.recentPopupCountFromOpener === 2) {
    score += 10;
    reasons.push("Multiple popups from the same page in a short window");
  }

  if (input.openedInBackground) {
    score += 15;
    reasons.push("Opened without becoming the active tab (pop-under pattern)");
  }

  if (input.redirectChainLength >= 3) {
    score += 10;
    reasons.push("Reached via a multi-step redirect chain");
  }

  // A recent, same-origin gesture with no ad/scam match and no burst is a
  // strong legitimacy signal (e.g. "Login with Google", "Open in new tab").
  if (hasRecentGesture && !crossOrigin && !input.matchesKnownAdRule && !input.matchesScamRule) {
    score -= 20;
    reasons.push("Recent same-origin user action; looks intentional");
  } else if (
    hasRecentGesture &&
    crossOrigin &&
    !input.matchesKnownAdRule &&
    !input.matchesScamRule &&
    input.recentPopupCountFromOpener <= 1
  ) {
    // e.g. OAuth popups are cross-origin but single, gesture-driven, and
    // not on any known ad/scam list.
    score -= 15;
    reasons.push("Single cross-origin popup immediately following a click (e.g. login flow)");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierForScore(score), reasons };
}

/** Convenience helper for the background engine's block/allow decision. */
export function shouldBlockPopup(result: PopupRiskResult, allowUserInitiated: boolean): boolean {
  if (allowUserInitiated && result.tier === "low") return false;
  return result.tier === "high" || result.tier === "critical" || result.tier === "medium";
}
