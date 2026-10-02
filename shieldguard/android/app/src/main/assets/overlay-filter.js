window.chrome={runtime:{getURL:function(p){return p;},sendMessage:function(){return Promise.resolve(undefined);}}};
window.fetch=(function(of){return function(u){if(u==='rules/annoyances.json'&&window.__SG_ANNOY){return Promise.resolve(new Response(JSON.stringify(window.__SG_ANNOY)));}return of.apply(this,arguments);};})(window.fetch);
"use strict";
(() => {
  // src/content/overlay-filter.ts
  var config = null;
  var overlaysEnabled = true;
  var annoyancesEnabled = true;
  var handled = /* @__PURE__ */ new WeakSet();
  async function loadConfig() {
    const res = await fetch(chrome.runtime.getURL("rules/annoyances.json"));
    return await res.json();
  }
  async function loadSiteState() {
    try {
      const tabState = await chrome.runtime.sendMessage({
        type: "GET_CURRENT_TAB_STATE"
      });
      const categories = tabState?.settings?.categories;
      if (categories) {
        overlaysEnabled = categories.overlays;
        annoyancesEnabled = categories.annoyances;
      }
    } catch {
    }
  }
  function isLargeViewportOverlay(el) {
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
  function containsProtectedContent(el, protectedSelectors) {
    return protectedSelectors.some((sel) => {
      try {
        return el.matches(sel) || el.querySelector(sel) !== null;
      } catch {
        return false;
      }
    });
  }
  function reportRemoval(reason) {
    const message = {
      type: "COSMETIC_OVERLAY_REMOVED",
      domain: location.hostname,
      reason
    };
    chrome.runtime.sendMessage(message).catch(() => void 0);
  }
  function scan() {
    if (!config) return;
    if (!overlaysEnabled && !annoyancesEnabled) return;
    for (const selector of config.keywordSelectors) {
      let matches;
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
        el.style.setProperty("display", "none", "important");
        document.body.style.removeProperty("overflow");
        reportRemoval(`Matched selector "${selector}" with full-viewport fixed/sticky positioning`);
      }
    }
  }
  var throttledScan = /* @__PURE__ */ (() => {
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
  async function init() {
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
})();
