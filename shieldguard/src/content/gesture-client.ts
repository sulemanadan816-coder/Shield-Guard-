/**
 * Records trusted (isTrusted === true) click/keydown gestures so the
 * background service worker's popup heuristic can distinguish
 * "user clicked something" from "page auto-triggered this". Only the
 * clicked element's tag/role-ish info and the page origin are sent --
 * never form contents, keystrokes, or any typed text.
 */
import type { RuntimeMessage } from "../lib/types";

function report(): void {
  const message: RuntimeMessage = {
    type: "POPUP_GESTURE",
    targetOrigin: location.origin
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Background may not be ready yet (e.g. right at navigation start);
    // this is best-effort and safe to drop.
  });
}

function onTrustedGesture(evt: Event): void {
  if (!evt.isTrusted) return;
  report();
}

document.addEventListener("click", onTrustedGesture, { capture: true, passive: true });
document.addEventListener("keydown", onTrustedGesture, { capture: true, passive: true });
document.addEventListener("auxclick", onTrustedGesture, { capture: true, passive: true });
