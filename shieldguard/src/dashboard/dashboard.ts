import type {
  CategoryToggleState,
  DailyStatistics,
  EventCategory,
  ProtectionEvent,
  RuntimeMessage,
  SiteSettings,
  SubscriptionState,
  UserSettings,
  ProtectionDiagnostics,
  ScheduleRule,
  CustomRule
} from "../lib/types";
import { PROTECTION_PROFILES } from "../lib/profiles";
import { validateCustomRulePattern, normalizeCustomRuleDomain, MAX_CUSTOM_RULES } from "../lib/custom-rules";
import { getRuleMeta } from "../lib/rules-meta";
import { t } from "../lib/i18n";
import type { FilterRuleMeta } from "../lib/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function send<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function categoryLabel(cat: EventCategory): string {
  const map: Record<EventCategory, string> = {
    popup: "Popup",
    ad: "Ad",
    redirect: "Redirect",
    tracker: "Tracker",
    overlay: "Overlay",
    annoyance: "Annoyance"
  };
  return map[cat];
}

const content = document.getElementById("content")!;
const modalBackdrop = document.getElementById("modalBackdrop")!;
const modal = document.getElementById("modal")!;

// Make non-native clickable elements (role="button" divs like cards/tiles/rows)
// operable with the keyboard: Enter/Space triggers the same click handler that
// the mouse path already wires up.
content.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = (e.target as HTMLElement).closest<HTMLElement>('[role="button"]');
  if (!target) return;
  e.preventDefault();
  target.click();
});

function openModal(html: string): void {
  modal.innerHTML = html;
  modalBackdrop.hidden = false;
  modal.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModal));
}
function closeModal(): void {
  modalBackdrop.hidden = true;
  modal.innerHTML = "";
}
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

async function localizeStaticChrome(): Promise<void> {
  const navLabels: Record<string, string> = {
    "control-center": t("navControlCenter", "Control Center"),
    "content-filter": t("navContentFilter", "Content Filter"),
    "site-manager": t("navSiteManager", "Site Manager"),
    "event-history": t("navEventHistory", "Event History"),
    settings: t("navSettings", "Settings"),
    premium: t("navPremium", "Premium / Pro"),
    more: t("navMore", "More")
  };
  document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a[data-route]").forEach((a) => {
    const route = a.dataset.route;
    if (route && navLabels[route]) a.textContent = navLabels[route];
  });
}

async function refreshPlanBadge(): Promise<void> {
  const { premium } = await send<{ premium: boolean; subscription: SubscriptionState }>({
    type: "GET_SUBSCRIPTION"
  });
  const badge = document.getElementById("sidebarPlanBadge")!;
  badge.textContent = premium ? "PRO PLAN" : "FREE PLAN";
  badge.classList.toggle("pro", premium);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type Route =
  | "control-center"
  | "content-filter"
  | "site-manager"
  | "event-history"
  | "settings"
  | "premium"
  | "protection-health"
  | "more";

const routes: Record<Route, () => Promise<void>> = {
  "control-center": renderControlCenter,
  "content-filter": renderContentFilter,
  "site-manager": renderSiteManager,
  "event-history": renderEventHistory,
  settings: renderSettings,
  premium: renderPremium,
  "protection-health": renderProtectionHealth,
  more: renderMore
};

function currentRoute(): Route {
  const hash = location.hash.replace("#", "") as Route;
  return hash in routes ? hash : "control-center";
}

async function navigate(): Promise<void> {
  const route = currentRoute();
  document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === route);
  });
  content.innerHTML = `<div class="empty-state">Loading…</div>`;
  await routes[route]();
}

window.addEventListener("hashchange", () => void navigate());

// ---------------------------------------------------------------------------
// Control Center
// ---------------------------------------------------------------------------

type StatsRange = "today" | "yesterday" | "7d" | "30d" | "all";
let controlCenterRange: StatsRange = "today";
let feedPollHandle: ReturnType<typeof setInterval> | null = null;

async function renderControlCenter(): Promise<void> {
  if (feedPollHandle) clearInterval(feedPollHandle);

  const [stats, allSites, events] = await Promise.all([
    send<DailyStatistics>({ type: "GET_STATISTICS", range: controlCenterRange }),
    getAllSites(),
    send<ProtectionEvent[]>({ type: "GET_EVENTS", filter: "all", limit: 25 })
  ]);
  const totalThreats = stats.popups + stats.ads + stats.redirects + stats.trackers + stats.overlays + stats.annoyances;

  content.innerHTML = `
    <h1 class="page-title">${t("controlCenter", "Control Center")}</h1>
    <p class="page-subtitle">${t("controlCenterSubtitle", "Your browsing protection at a glance.")}</p>

    <div class="range-tabs" id="rangeTabs">
      ${(["today", "yesterday", "7d", "30d", "all"] as StatsRange[])
        .map(
          (r) =>
            `<button data-range="${r}" class="${r === controlCenterRange ? "active" : ""}">${rangeLabel(r)}</button>`
        )
        .join("")}
    </div>

    <div class="card-grid">
      <div class="card"><div class="card-value">${totalThreats}</div><div class="card-label">${t("cardThreatsBlocked", "Threats Blocked")}</div></div>
      <div class="card"><div class="card-value">${stats.popups}</div><div class="card-label">${t("cardPopupsBlocked", "Popups Blocked")}</div></div>
      <div class="card"><div class="card-value">${stats.ads}</div><div class="card-label">${t("cardAdsBlocked", "Ads Blocked")}</div></div>
      <div class="card"><div class="card-value">${stats.redirects}</div><div class="card-label">${t("cardRedirectsBlocked", "Redirects Blocked")}</div></div>
      <div class="card"><div class="card-value">${stats.trackers}</div><div class="card-label">${t("cardTrackersBlocked", "Trackers Blocked")}</div></div>
      <div class="card"><div class="card-value">${allSites.length}</div><div class="card-label">${t("cardProtectedSites", "Protected Sites")}</div></div>
    </div>

    <div class="section">
      <h2>${t("liveProtection", "Live Protection")}</h2>
      <div class="feed-list" id="feedList">${renderFeedRows(events)}</div>
    </div>
  `;

  document.getElementById("rangeTabs")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-range]");
    if (!btn) return;
    controlCenterRange = btn.dataset.range as StatsRange;
    void renderControlCenter();
  });

  wireFeedRowClicks();

  feedPollHandle = setInterval(async () => {
    const latest = await send<ProtectionEvent[]>({ type: "GET_EVENTS", filter: "all", limit: 25 });
    const list = document.getElementById("feedList");
    if (list) {
      list.innerHTML = renderFeedRows(latest);
      wireFeedRowClicks();
    }
  }, 4000);
}

function rangeLabel(r: StatsRange): string {
  return {
    today: t("rangeToday", "Today"),
    yesterday: t("rangeYesterday", "Yesterday"),
    "7d": t("range7d", "Last 7 Days"),
    "30d": t("range30d", "Last 30 Days"),
    all: t("rangeAll", "All Time")
  }[r];
}

function renderFeedRows(events: ProtectionEvent[]): string {
  if (events.length === 0) {
    return `<div class="empty-state">No protection events yet. ShieldGuard is watching in the background.</div>`;
  }
  return events
    .map(
      (e) => `
      <div class="feed-row" data-event-id="${e.id}" role="button" tabindex="0" aria-label="View details for ${categoryLabel(e.category)} event on ${escapeHtml(e.domain)}">
        <span class="feed-time">${formatTime(e.timestamp)}</span>
        <span class="badge-cat">${categoryLabel(e.category)}</span>
        <span class="feed-domain">${escapeHtml(e.domain)}</span>
        <span class="badge-action ${e.action}">${e.action.toUpperCase()}</span>
      </div>`
    )
    .join("");
}

function wireFeedRowClicks(): void {
  document.querySelectorAll<HTMLElement>(".feed-row[data-event-id]").forEach((row) => {
    row.addEventListener("click", () => void openEventDetail(row.dataset.eventId!));
  });
}

async function getAllSites(): Promise<SiteSettings[]> {
  const all = await send<Record<string, SiteSettings>>({ type: "GET_ALL_SITES" });
  return Object.values(all ?? {});
}

async function openEventDetail(eventId: string): Promise<void> {
  const events = await send<ProtectionEvent[]>({ type: "GET_EVENTS", filter: "all" });
  const evt = events.find((e) => e.id === eventId);
  if (!evt) return;
  const riskTier = evt.riskScore === undefined ? null : tierFor(evt.riskScore);
  openModal(`
    <h2>Protection Event</h2>
    <p><strong>Domain:</strong> ${escapeHtml(evt.domain)}</p>
    ${evt.destinationUrl ? `<p><strong>Destination:</strong> ${escapeHtml(evt.destinationUrl)}</p>` : ""}
    <p><strong>Category:</strong> ${categoryLabel(evt.category)}</p>
    ${
      evt.riskScore !== undefined
        ? `<p><strong>Risk:</strong> <span class="risk-pill risk-${riskTier}">${evt.riskScore}/100 · ${riskTier?.toUpperCase()}</span></p>`
        : ""
    }
    <p><strong>Reasons:</strong></p>
    <ul class="reasons">${evt.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    <p><strong>Action:</strong> ${evt.action.toUpperCase()}</p>
    <div class="modal-close-row">
      <button class="btn btn-secondary btn-sm" data-decision="allow_once">Allow Once</button>
      <button class="btn btn-secondary btn-sm" data-decision="trust_domain">Trust Domain</button>
      <button class="btn btn-primary btn-sm" data-close-modal>Keep Blocking</button>
    </div>
  `);
  modal.querySelectorAll<HTMLButtonElement>("[data-decision]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "EVENT_DECISION", eventId: evt.id, decision: btn.dataset.decision as "allow_once" | "trust_domain" });
      closeModal();
      void navigate();
    });
  });
}

function tierFor(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Content Filter
// ---------------------------------------------------------------------------

const CONTENT_FILTER_CATEGORIES: { key: keyof CategoryToggleState; name: string; i18nKey: string; desc: string }[] = [
  { key: "ads", name: "Advertising", i18nKey: "catAdvertising", desc: "Block advertising network resources." },
  { key: "trackers", name: "Trackers", i18nKey: "catTrackers", desc: "Block known tracking and analytics resources." },
  { key: "popups", name: "Popups", i18nKey: "catPopups", desc: "Block popup and pop-under behavior." },
  { key: "redirects", name: "Redirects", i18nKey: "catRedirects", desc: "Block suspicious redirect behavior." },
  { key: "annoyances", name: "Annoyances", i18nKey: "catAnnoyances", desc: "Hide common intrusive website elements." },
  { key: "socialWidgets", name: "Social Widgets", i18nKey: "catSocialWidgets", desc: "Optional blocking of embedded social widgets." },
  { key: "cryptoMining", name: "Cryptocurrency Mining", i18nKey: "catCryptoMining", desc: "Block known browser-mining-related resources." },
  { key: "scamMalvertising", name: "Scam / Malvertising", i18nKey: "catScamMalvertising", desc: "Rules for known malicious advertising domains." }
];

function filterLevelName(level: string): string {
  const keys: Record<string, string> = {
    basic: "levelBasic",
    balanced: "levelBalanced",
    strict: "levelStrict",
    lockdown: "levelLockdown",
    custom: "levelCustom"
  };
  const fallback = level.charAt(0).toUpperCase() + level.slice(1);
  return t(keys[level] ?? "", fallback);
}

async function renderContentFilter(): Promise<void> {
  const [settings, ruleMeta] = await Promise.all([
    send<UserSettings>({ type: "GET_SETTINGS" }),
    getRuleMeta()
  ]);
  const metaByCategory = new Map(ruleMeta.map((m) => [m.category, m]));

  content.innerHTML = `
    <h1 class="page-title">${t("contentFilterTitle", "Content Filter")}</h1>
    <p class="page-subtitle">${t("contentFilterSubtitle", "Fine-grained control over what ShieldGuard filters.")}</p>

    <div class="section">
      <h2>${t("filterLevel", "Filter Level")}</h2>
      <div class="profile-grid" id="filterLevelGrid">
        ${(["basic", "balanced", "strict", "lockdown", "custom"] as const)
          .map(
            (level) => `
          <div class="profile-card ${settings.filterLevel === level ? "active" : ""}" data-level="${level}" role="button" tabindex="0" aria-pressed="${settings.filterLevel === level}">
            <h3>${filterLevelName(level)}</h3>
            <p>${filterLevelDesc(level)}</p>
          </div>`
          )
          .join("")}
      </div>
      ${
        settings.filterLevel === "strict" || settings.filterLevel === "lockdown"
          ? `<div class="notice" style="margin-top:14px;">${t("lockdownWarning", "Strict and Lockdown modes may cause some websites to malfunction.")}</div>`
          : ""
      }
    </div>

    <div class="section">
      <h2>${t("categories", "Categories")}</h2>
      <div id="categoryRows">
        ${CONTENT_FILTER_CATEGORIES.map((c) => {
          const meta = metaByCategory.get(c.key as never);
          const countLabel = meta ? `${meta.ruleCount} rules` : "Behavioral detection";
          return `
          <div class="filter-category-row" data-key="${c.key}">
            <div>
              <div class="filter-category-name">${t(c.i18nKey, c.name)}</div>
              <div class="filter-category-desc">${c.desc}</div>
            </div>
            <span class="filter-category-count">${countLabel}</span>
            <div class="btn-row">
              <button class="btn btn-secondary btn-sm" data-view-rules="${c.key}">${t("viewRules", "View Rules")}</button>
              <button class="toggle" role="switch" aria-checked="${settings.categories[c.key]}"><span class="knob"></span></button>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  document.getElementById("filterLevelGrid")!.addEventListener("click", async (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-level]");
    if (!card) return;
    const level = card.dataset.level as UserSettings["filterLevel"];
    await applyFilterLevel(level);
    void renderContentFilter();
  });

  document.getElementById("categoryRows")!.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const viewRulesKey = target.closest<HTMLElement>("[data-view-rules]")?.dataset.viewRules;
    if (viewRulesKey) {
      await showRuleModal(viewRulesKey as keyof CategoryToggleState);
      return;
    }
    const toggle = target.closest<HTMLElement>(".toggle");
    if (toggle) {
      const row = toggle.closest<HTMLElement>(".filter-category-row")!;
      const key = row.dataset.key as keyof CategoryToggleState;
      const current = await send<UserSettings>({ type: "GET_SETTINGS" });
      await send({ type: "SET_SETTINGS", settings: { categories: { ...current.categories, [key]: !current.categories[key] } } });
      void renderContentFilter();
    }
  });
}

function filterLevelDesc(level: string): string {
  switch (level) {
    case "basic":
      return "Light-touch protection for maximum compatibility.";
    case "balanced":
      return "Solid protection for everyday browsing.";
    case "strict":
      return "More aggressive protection.";
    case "lockdown":
      return "Maximum protection.";
    default:
      return "You control individual protection categories.";
  }
}

async function applyFilterLevel(level: UserSettings["filterLevel"]): Promise<void> {
  const presets: Record<string, Partial<CategoryToggleState>> = {
    basic: { popups: true, redirects: true, ads: true, trackers: false, annoyances: false, socialWidgets: false, cryptoMining: false, scamMalvertising: true, overlays: false },
    balanced: { popups: true, redirects: true, ads: true, trackers: true, annoyances: true, socialWidgets: false, cryptoMining: true, scamMalvertising: true, overlays: true },
    strict: { popups: true, redirects: true, ads: true, trackers: true, annoyances: true, socialWidgets: true, cryptoMining: true, scamMalvertising: true, overlays: true },
    lockdown: { popups: true, redirects: true, ads: true, trackers: true, annoyances: true, socialWidgets: true, cryptoMining: true, scamMalvertising: true, overlays: true }
  };
  const current = await send<UserSettings>({ type: "GET_SETTINGS" });
  const patch: Partial<UserSettings> = { filterLevel: level };
  if (level !== "custom") {
    patch.categories = { ...current.categories, ...presets[level] };
  }
  await send({ type: "SET_SETTINGS", settings: patch });
}

async function showRuleModal(key: keyof CategoryToggleState): Promise<void> {
  const ruleMeta = await getRuleMeta();
  const meta = ruleMeta.find((m) => m.category === (key as unknown as FilterRuleMeta["category"]));
  const catDef = CONTENT_FILTER_CATEGORIES.find((c) => c.key === key);
  const catName = catDef ? t(catDef.i18nKey, catDef.name) : String(key);
  openModal(`
    <h2>${catName}</h2>
    <p>${catDef?.desc ?? ""}</p>
    ${
      meta
        ? `<p><strong>${meta.ruleCount}</strong> rules loaded from <code>${escapeHtml(meta.fileName)}</code>.</p>`
        : `<p>This category is enforced through behavioral detection rather than a static rule file.</p>`
    }
    <p style="color:var(--sg-muted);font-size:12.5px;">Rules are bundled with the extension and applied entirely on-device via Chrome's declarativeNetRequest API — no remote code is downloaded or executed.</p>
    <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
  `);
}

// ---------------------------------------------------------------------------
// Site Manager
// ---------------------------------------------------------------------------

async function renderSiteManager(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabState = tab?.id
    ? await send<{ domain: string | null; site?: SiteSettings; protectedNow: boolean }>({
        type: "GET_TAB_STATE",
        tabId: tab.id
      })
    : { domain: null, site: undefined, protectedNow: false };

  const allSites = await getAllSites();
  const trusted = allSites.filter((s) => s.mode === "trusted");

  content.innerHTML = `
    <h1 class="page-title">${t("siteManagerTitle", "Site Manager")}</h1>
    <p class="page-subtitle">${t("siteManagerSubtitle", "Per-domain protection settings.")}</p>

    <div class="section">
      <h2>Current Site${tabState.domain ? `: ${escapeHtml(tabState.domain)}` : ""}</h2>
      ${
        tabState.domain
          ? `
        <p>Protection: <strong>${tabState.protectedNow ? "🟢 ACTIVE" : "⚪ INACTIVE"}</strong></p>
        ${renderPauseStatus(tabState.site)}
        <div id="currentSiteCategories">${renderCategoryToggleRows(
          tabState.site?.categories ?? DEFAULT_CATS_PLACEHOLDER
        )}</div>
        <div class="settings-row">
          <div class="settings-row-label">Lockdown</div>
          <button class="toggle" id="siteLockdownToggle" role="switch" aria-checked="${tabState.site?.lockdown ?? false}"><span class="knob"></span></button>
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn btn-secondary btn-sm" id="pause10">Pause for 10 minutes</button>
          <button class="btn btn-secondary btn-sm" id="pauseHour">Pause for 1 hour</button>
          <button class="btn btn-secondary btn-sm" id="pauseRestart">Pause until browser restart</button>
          <button class="btn btn-secondary btn-sm" id="pauseManual">Pause until manually re-enabled</button>
          <button class="btn btn-secondary btn-sm" id="trustSite">Trust this site</button>
          <button class="btn btn-danger btn-sm" id="resetSite">Reset site settings</button>
        </div>`
          : `<p class="empty-state">Open a website tab to manage its protection settings.</p>`
      }
    </div>

    <div class="section">
      <h2>Trusted Sites</h2>
      ${
        trusted.length === 0
          ? `<div class="empty-state">No trusted sites yet.</div>`
          : trusted
              .map(
                (s) => `
        <div class="site-list-row">
          <span>${escapeHtml(s.domain)}</span>
          <span class="pill trusted">Trusted</span>
          <span style="color:var(--sg-muted);font-size:12px;">${new Date(s.addedAt).toLocaleDateString()}</span>
          <button class="btn btn-secondary btn-sm" data-remove-trust="${escapeHtml(s.domain)}">Remove</button>
        </div>`
              )
              .join("")
      }
    </div>
  `;

  if (tabState.domain && tab?.id) {
    const domain = tabState.domain;

    document.getElementById("currentSiteCategories")?.addEventListener("click", async (e) => {
      const toggle = (e.target as HTMLElement).closest<HTMLElement>(".toggle");
      if (!toggle) return;
      const key = toggle.closest<HTMLElement>("[data-key]")!.dataset.key as keyof CategoryToggleState;
      const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
      const site: SiteSettings = tabState.site ?? {
        domain,
        mode: "protected",
        categories: settings.categories,
        lockdown: false,
        addedAt: Date.now()
      };
      site.categories = { ...site.categories, [key]: !site.categories[key] };
      await send({ type: "SET_SITE_SETTINGS", site });
      void renderSiteManager();
    });

    document.getElementById("siteLockdownToggle")?.addEventListener("click", async () => {
      const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
      const site: SiteSettings = tabState.site ?? {
        domain,
        mode: "protected",
        categories: settings.categories,
        lockdown: false,
        addedAt: Date.now()
      };
      site.lockdown = !site.lockdown;
      await send({ type: "SET_SITE_SETTINGS", site });
      void renderSiteManager();
    });

    document.getElementById("pause10")?.addEventListener("click", async () => {
      await send({ type: "PAUSE_SITE", domain, durationMs: 10 * 60 * 1000 });
      void renderSiteManager();
    });
    document.getElementById("pauseHour")?.addEventListener("click", async () => {
      await send({ type: "PAUSE_SITE", domain, durationMs: 60 * 60 * 1000 });
      void renderSiteManager();
    });
    document.getElementById("pauseRestart")?.addEventListener("click", async () => {
      await send({ type: "PAUSE_SITE", domain, durationMs: "restart" });
      void renderSiteManager();
    });
    document.getElementById("pauseManual")?.addEventListener("click", async () => {
      await send({ type: "PAUSE_SITE", domain, durationMs: "manual" });
      void renderSiteManager();
    });
    document.getElementById("trustSite")?.addEventListener("click", async () => {
      await send({ type: "TRUST_SITE", domain });
      void renderSiteManager();
    });
    document.getElementById("resetSite")?.addEventListener("click", async () => {
      await send({ type: "RESET_SITE", domain });
      void renderSiteManager();
    });
  }

  document.querySelectorAll<HTMLButtonElement>("[data-remove-trust]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "RESET_SITE", domain: btn.dataset.removeTrust! });
      void renderSiteManager();
    });
  });
}

const DEFAULT_CATS_PLACEHOLDER: CategoryToggleState = {
  popups: true,
  redirects: true,
  ads: true,
  trackers: true,
  annoyances: true,
  socialWidgets: false,
  cryptoMining: true,
  scamMalvertising: true,
  overlays: true
};

function renderPauseStatus(site: SiteSettings | undefined): string {
  if (!site || site.mode !== "paused") return "";
  let detail: string;
  if (site.pausedUntil === "restart") {
    detail = "Paused until the browser restarts.";
  } else if (!site.pausedUntil) {
    detail = "Paused until manually re-enabled.";
  } else if (site.pausedUntil > Date.now()) {
    detail = `Paused until ${new Date(site.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  } else {
    detail = "Pause has expired; protection will resume shortly.";
  }
  return `<p class="page-subtitle" style="margin:-2px 0 10px;">⏸ ${detail}</p>`;
}

function renderCategoryToggleRows(categories: CategoryToggleState): string {
  const rows: { key: keyof CategoryToggleState; name: string }[] = [
    { key: "popups", name: "Popup Protection" },
    { key: "ads", name: "Ad Protection" },
    { key: "redirects", name: "Redirect Protection" },
    { key: "trackers", name: "Tracker Protection" },
    { key: "overlays", name: "Overlay Protection" }
  ];
  return rows
    .map(
      (r) => `
    <div class="settings-row" data-key="${r.key}">
      <div class="settings-row-label">${r.name}</div>
      <button class="toggle" role="switch" aria-checked="${categories[r.key]}"><span class="knob"></span></button>
    </div>`
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Event History
// ---------------------------------------------------------------------------

let eventFilter: EventCategory | "all" = "all";
let eventSearch = "";

async function renderEventHistory(): Promise<void> {
  const [events, { premium }] = await Promise.all([
    send<ProtectionEvent[]>({
      type: "GET_EVENTS",
      filter: eventFilter,
      search: eventSearch || undefined
    }),
    send<{ premium: boolean; subscription: SubscriptionState }>({ type: "GET_SUBSCRIPTION" })
  ]);

  const filters: (EventCategory | "all")[] = ["all", "popup", "ad", "tracker", "redirect", "overlay"];

  content.innerHTML = `
    <h1 class="page-title">${t("eventHistoryTitle", "Blocked Activity")}</h1>
    <p class="page-subtitle">${t("eventHistorySubtitle", "Everything ShieldGuard blocked.")}</p>

    <div class="range-tabs" id="eventFilters">
      ${filters
        .map(
          (f) =>
            `<button data-filter="${f}" class="${f === eventFilter ? "active" : ""}">${
              f === "all" ? "All" : categoryLabel(f) + "s"
            }</button>`
        )
        .join("")}
    </div>

    <input type="search" id="eventSearch" placeholder="Search domain or URL…" value="${escapeHtml(eventSearch)}" style="width:100%;margin-bottom:14px;" />

    <div class="section">
      ${
        events.length === 0
          ? `<div class="empty-state">No matching events.</div>`
          : `<div class="feed-list" id="eventTable" style="max-height:none;">${renderFeedRows(events)}</div>`
      }
      ${
        !premium && events.length >= 50
          ? `<p class="page-subtitle" style="margin-top:10px;">Free plan shows your most recent 50 events. <a href="#premium" data-route="premium">Upgrade to Pro</a> for extended history.</p>`
          : ""
      }
    </div>

    <div class="btn-row">
      <button class="btn btn-danger btn-sm" id="clearHistory">Clear All Activity</button>
    </div>
  `;

  document.getElementById("eventFilters")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-filter]");
    if (!btn) return;
    eventFilter = btn.dataset.filter as EventCategory | "all";
    void renderEventHistory();
  });

  const searchInput = document.getElementById("eventSearch") as HTMLInputElement;
  let searchDebounce: ReturnType<typeof setTimeout>;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      eventSearch = searchInput.value;
      void renderEventHistory();
    }, 250);
  });

  wireFeedRowClicks();

  document.getElementById("clearHistory")?.addEventListener("click", async () => {
    await send({ type: "CLEAR_EVENTS" });
    void renderEventHistory();
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function renderSettings(): Promise<void> {
  const settings = await send<UserSettings>({ type: "GET_SETTINGS" });

  content.innerHTML = `
    <h1 class="page-title">${t("settingsTitle", "Settings")}</h1>
    <p class="page-subtitle">${t("settingsSubtitle", "Global configuration.")}</p>

    <div class="section">
      <h2>General</h2>
      ${settingsToggleRow("protectionEnabled", "Protection enabled", "Master switch for all ShieldGuard protection.", settings.protectionEnabled)}
      ${settingsToggleRow("startProtectionAutomatically", "Start protection automatically", "Enable protection as soon as Chrome starts.", settings.startProtectionAutomatically)}
      ${settingsToggleRow("showBadgeCounter", "Badge counter", "Show today's blocked count on the toolbar icon.", settings.showBadgeCounter)}
      ${settingsToggleRow("showSummaryNotifications", "Notifications", "Show an occasional summary notification instead of one per event.", settings.showSummaryNotifications)}
      ${settingsToggleRow("logBlockedEvents", "Log blocked events", "Keep a local record of blocked/flagged events for Event History and statistics.", settings.logBlockedEvents)}
    </div>

    <div class="section">
      <h2>Popup Protection</h2>
      ${settingsToggleRow("categories.popups", "Enable popup protection", "Detect and act on unwanted popup/pop-under tabs.", settings.categories.popups)}
      ${settingsToggleRow("closeSuspiciousTabsAutomatically", "Close suspicious tabs", "Automatically close tabs ShieldGuard identifies as unwanted popups.", settings.closeSuspiciousTabsAutomatically)}
      ${settingsToggleRow("allowUserInitiatedPopups", "Allow user-initiated popups", "Never block low-risk popups that immediately follow your own click (e.g. login windows).", settings.allowUserInitiatedPopups)}
    </div>

    <div class="section">
      <h2>Redirect Protection</h2>
      ${settingsToggleRow("categories.redirects", "Enable redirect protection", "Monitor navigation for suspicious redirect chains.", settings.categories.redirects)}
      ${settingsToggleRow("blockSuspiciousRedirectChains", "Block suspicious redirect chains", "Flag rapid, multi-domain redirect sequences.", settings.blockSuspiciousRedirectChains)}
      ${settingsToggleRow("quietProtectionMode", "Quiet Protection Mode", "Handle suspicious redirects silently -- never show a full-page warning. Only turn this off if you want ShieldGuard to interrupt browsing for the rare, high-confidence case (e.g. a same-site redirect loop).", settings.quietProtectionMode)}
    </div>

    <div class="section">
      <h2>Content</h2>
      ${settingsToggleRow("categories.ads", "Ads", "Block advertising resources.", settings.categories.ads)}
      ${settingsToggleRow("categories.trackers", "Trackers", "Block tracking/analytics resources.", settings.categories.trackers)}
      ${settingsToggleRow("categories.annoyances", "Annoyances", "Hide intrusive page elements.", settings.categories.annoyances)}
      ${settingsToggleRow("categories.overlays", "Overlays", "Remove full-screen popup overlays and fake download prompts.", settings.categories.overlays)}
    </div>

    <div class="section">
      <h2>Privacy</h2>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Event history retention</div>
          <div class="settings-row-desc">How long blocked-event history is kept locally.</div>
        </div>
        <select id="retentionSelect">
          ${["7d", "30d", "90d", "forever", "disabled"]
            .map((r) => `<option value="${r}" ${settings.retention === r ? "selected" : ""}>${retentionLabel(r)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Local statistics</div>
          <div class="settings-row-desc">All statistics are computed from real local event data. Nothing is sent to a server unless you opt in below.</div>
        </div>
      </div>
      ${settingsToggleRow("cloudReputationOptIn", "Cloud reputation service (opt-in)", "Off by default. When enabled, ShieldGuard may check destination domains against a reputation service. No page content, form data, or browsing history is ever sent.", settings.cloudReputationOptIn)}
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-danger btn-sm" id="clearHistoryBtn">Clear History</button>
      </div>
    </div>

    <div class="section">
      <h2>Appearance</h2>
      <div class="settings-row">
        <div class="settings-row-label">Theme</div>
        <select id="themeSelect">
          ${["system", "light", "dark"]
            .map((t) => `<option value="${t}" ${settings.theme === t ? "selected" : ""}>${t.charAt(0).toUpperCase()}${t.slice(1)}</option>`)
            .join("")}
        </select>
      </div>
      ${settingsToggleRow("reducedMotion", "Reduced motion", "Minimize animations throughout ShieldGuard.", settings.reducedMotion)}
    </div>
  `;

  content.querySelectorAll<HTMLElement>(".toggle[data-path]").forEach((toggle) => {
    toggle.addEventListener("click", async () => void toggleSetting(toggle.dataset.path!));
  });

  document.getElementById("retentionSelect")?.addEventListener("change", async (e) => {
    const value = (e.target as HTMLSelectElement).value as UserSettings["retention"];
    await send({ type: "SET_SETTINGS", settings: { retention: value } });
  });
  document.getElementById("themeSelect")?.addEventListener("change", async (e) => {
    const value = (e.target as HTMLSelectElement).value as UserSettings["theme"];
    await send({ type: "SET_SETTINGS", settings: { theme: value } });
    applyTheme(value);
  });
  document.getElementById("clearHistoryBtn")?.addEventListener("click", async () => {
    await send({ type: "CLEAR_EVENTS" });
  });
}

function retentionLabel(r: string): string {
  return { "7d": "7 days", "30d": "30 days", "90d": "90 days", forever: "Forever", disabled: "Disabled" }[r] ?? r;
}

function settingsToggleRow(path: string, label: string, desc: string, value: boolean): string {
  return `
    <div class="settings-row">
      <div>
        <div class="settings-row-label">${label}</div>
        <div class="settings-row-desc">${desc}</div>
      </div>
      <button class="toggle" data-path="${path}" role="switch" aria-checked="${value}"><span class="knob"></span></button>
    </div>`;
}

async function toggleSetting(path: string): Promise<void> {
  const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
  if (path.startsWith("categories.")) {
    const key = path.split(".")[1] as keyof CategoryToggleState;
    await send({ type: "SET_SETTINGS", settings: { categories: { ...settings.categories, [key]: !settings.categories[key] } } });
  } else {
    const key = path as keyof UserSettings;
    const nextValue = !settings[key];
    await send({ type: "SET_SETTINGS", settings: { [key]: nextValue } as Partial<UserSettings> });
    if (path === "reducedMotion") applyReducedMotion(nextValue as boolean);
  }
  void renderSettings();
}

function applyReducedMotion(enabled: boolean): void {
  document.documentElement.dataset.reducedMotion = String(enabled);
}

function applyTheme(theme: UserSettings["theme"]): void {
  document.documentElement.dataset.theme = theme;
}

// ---------------------------------------------------------------------------
// Premium / Pro
// ---------------------------------------------------------------------------

async function renderPremium(): Promise<void> {
  const [{ premium, subscription }, settings, schedules, customRules] = await Promise.all([
    send<{ premium: boolean; subscription: SubscriptionState }>({ type: "GET_SUBSCRIPTION" }),
    send<UserSettings>({ type: "GET_SETTINGS" }),
    send<ScheduleRule[]>({ type: "GET_SCHEDULES" }),
    send<CustomRule[]>({ type: "GET_CUSTOM_RULES" })
  ]);

  content.innerHTML = `
    <h1 class="page-title">${premium ? "ShieldGuard Pro" : t("premiumTitle", "Premium / Pro")}</h1>
    <p class="page-subtitle">${premium ? "You have full access to ShieldGuard Pro." : t("premiumSubtitle", "Unlock advanced protection intelligence.")}</p>

    ${
      premium
        ? `
      <div class="section">
        <h2>🟢 PROTECTED — Plan: PRO</h2>
        <ul style="columns:2;gap:24px;font-size:13.5px;line-height:2;">
          <li>✓ Advanced Popup Intelligence</li>
          <li>✓ Smart Redirect Shield</li>
          <li>✓ Lockdown Mode</li>
          <li>✓ Advanced Ad Filtering</li>
          <li>✓ Advanced Tracker Protection</li>
          <li>✓ Custom Rules</li>
          <li>✓ Protection Profiles</li>
          <li>✓ Detailed Analytics</li>
          <li>✓ Extended Event History</li>
        </ul>
        <p style="color:var(--sg-muted);font-size:12.5px;">
          ${subscription.renewsAt ? `Renews ${new Date(subscription.renewsAt).toLocaleDateString()}.` : ""}
          ${subscription.licenseKeyLast4 ? ` License ending in ${escapeHtml(subscription.licenseKeyLast4)}.` : ""}
        </p>
        <div class="btn-row">
          <button class="btn btn-secondary btn-sm" id="manageSubBtn">Manage Subscription</button>
          <button class="btn btn-secondary btn-sm" id="logoutBtn">Log Out of Pro</button>
        </div>
      </div>`
        : `
      <div class="section">
        <h2>Activate a license</h2>
        <p style="font-size:12.5px;color:var(--sg-muted);">Enter your ShieldGuard Pro license key. No card details are ever stored by ShieldGuard.</p>
        <div class="btn-row">
          <input type="text" id="licenseInput" placeholder="SG-XXXX-XXXX-XXXX" style="flex:1;min-width:220px;" />
          <button class="btn btn-primary btn-sm" id="activateBtn">Activate</button>
        </div>
        <p id="licenseError" style="color:var(--sg-red);font-size:12.5px;margin-top:8px;"></p>
      </div>`
    }

    <div class="section">
      <h2>Free vs Pro</h2>
      <table class="compare">
        <thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead>
        <tbody>
          <tr><td>Popup Blocking</td><td class="check">✓</td><td class="check">✓ Advanced</td></tr>
          <tr><td>Redirect Protection</td><td class="check">✓</td><td class="check">✓ Advanced</td></tr>
          <tr><td>Ad Blocking</td><td>Basic</td><td>Advanced</td></tr>
          <tr><td>Tracker Blocking</td><td>Basic</td><td>Advanced</td></tr>
          <tr><td>Site Controls</td><td class="check">✓</td><td class="check">✓</td></tr>
          <tr><td>Statistics</td><td>Basic</td><td>Advanced</td></tr>
          <tr><td>Event History</td><td>Limited</td><td>Extended</td></tr>
          <tr><td>Lockdown Mode</td><td class="dash">—</td><td class="check">✓</td></tr>
          <tr><td>Custom Rules</td><td class="dash">—</td><td class="check">✓</td></tr>
          <tr><td>Protection Profiles</td><td class="dash">—</td><td class="check">✓</td></tr>
          <tr><td>Advanced Analytics</td><td class="dash">—</td><td class="check">✓</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Protection Profiles</h2>
      <div class="profile-grid">
        ${PROTECTION_PROFILES.map(
          (p) => `
          <div class="profile-card ${settings.activeProfile === p.id ? "active" : ""}" data-profile="${p.id}" role="button" tabindex="0" aria-pressed="${settings.activeProfile === p.id}">
            ${p.isPremium ? `<span class="pro-tag">PRO</span>` : ""}
            <h3>${p.name}</h3>
            <p>${p.description}</p>
          </div>`
        ).join("")}
      </div>
    </div>

    <div class="section">
      <h2>Scheduled Protection <span class="pro-tag" style="position:static;display:inline-block;vertical-align:middle;">PRO</span></h2>
      ${
        !premium
          ? `<p class="page-subtitle">Automatically switch protection profiles at set times -- e.g. Strict during work hours, Maximum Protection overnight. Activate ShieldGuard Pro to create schedules.</p>`
          : schedules.length === 0
            ? `<p class="page-subtitle">No schedules yet. Add one to automatically switch profiles at set times.</p>`
            : `<div class="schedule-list">
                ${schedules
                  .map((s) => {
                    const profile = PROTECTION_PROFILES.find((p) => p.id === s.profile);
                    return `
                  <div class="settings-row" data-schedule-id="${s.id}">
                    <div class="settings-row-label">
                      ${escapeHtml(s.label || "Untitled schedule")}
                      <p style="font-weight:400;color:var(--sg-muted);font-size:12px;margin:2px 0 0;">
                        ${formatDaysOfWeek(s.daysOfWeek)}, ${formatMinuteOfDay(s.startMinute)}–${formatMinuteOfDay(s.endMinute)} -> ${escapeHtml(profile?.name ?? s.profile)}
                        ${settings.activeScheduleId === s.id ? " <strong>(active now)</strong>" : ""}
                      </p>
                    </div>
                    <button class="toggle" role="switch" aria-checked="${s.enabled}" data-schedule-toggle="${s.id}"><span class="knob"></span></button>
                    <button class="btn btn-danger btn-sm" data-schedule-delete="${s.id}" style="margin-left:8px;">Delete</button>
                  </div>`;
                  })
                  .join("")}
              </div>`
      }
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn ${premium ? "btn-primary" : "btn-secondary"} btn-sm" id="addScheduleBtn">Add Schedule</button>
      </div>
    </div>

    <div class="section">
      <h2>Custom Rules <span class="pro-tag" style="position:static;display:inline-block;vertical-align:middle;">PRO</span></h2>
      ${
        !premium
          ? `<p class="page-subtitle">Block requests to specific domains that ShieldGuard's bundled rulesets don't already cover. Activate ShieldGuard Pro to add custom rules.</p>`
          : customRules.length === 0
            ? `<p class="page-subtitle">No custom rules yet. Add a domain to block it everywhere, on every site.</p>`
            : `<div class="custom-rule-list">
                ${customRules
                  .map(
                    (r) => `
                  <div class="settings-row" data-rule-id="${r.id}">
                    <div class="settings-row-label">${escapeHtml(r.domain)}</div>
                    <button class="toggle" role="switch" aria-checked="${r.enabled}" data-rule-toggle="${r.id}"><span class="knob"></span></button>
                    <button class="btn btn-danger btn-sm" data-rule-delete="${r.id}" style="margin-left:8px;">Delete</button>
                  </div>`
                  )
                  .join("")}
              </div>`
      }
      <p class="page-subtitle" style="font-size:11.5px;margin-top:8px;">A plain domain only -- no wildcards or paths -- e.g. "annoying-ads.example". Up to ${MAX_CUSTOM_RULES} rules.</p>
      <div class="btn-row" style="margin-top:6px;">
        <input type="text" id="newRuleDomain" placeholder="domain-to-block.example" style="flex:1;min-width:200px;" ${premium ? "" : "disabled"} />
        <button class="btn ${premium ? "btn-primary" : "btn-secondary"} btn-sm" id="addRuleBtn">Add Rule</button>
      </div>
      <p id="ruleError" style="color:var(--sg-red);font-size:12.5px;margin-top:6px;"></p>
    </div>
  `;

  document.getElementById("addScheduleBtn")?.addEventListener("click", () => {
    if (!premium) {
      openModal(`
        <h2>Pro Feature</h2>
        <p style="font-size:13px;">Scheduled Protection is part of ShieldGuard Pro. Activate a license to create schedules.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    }
    openAddScheduleModal(schedules);
  });

  content.querySelectorAll<HTMLElement>("[data-schedule-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.scheduleToggle!;
      const next = schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      const result = await send<{ error?: string }>({ type: "SET_SCHEDULES", schedules: next });
      if (result?.error) {
        openModal(`<h2>Couldn't save</h2><p style="font-size:13px;">${escapeHtml(result.error)}</p><div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>`);
        return;
      }
      void renderPremium();
    });
  });

  content.querySelectorAll<HTMLElement>("[data-schedule-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.scheduleDelete!;
      const next = schedules.filter((s) => s.id !== id);
      await send({ type: "SET_SCHEDULES", schedules: next });
      void renderPremium();
    });
  });

  document.getElementById("addRuleBtn")?.addEventListener("click", async () => {
    const errorEl = document.getElementById("ruleError")!;
    errorEl.textContent = "";
    if (!premium) {
      openModal(`
        <h2>Pro Feature</h2>
        <p style="font-size:13px;">Custom Rules is part of ShieldGuard Pro. Activate a license to add rules.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    }
    const input = document.getElementById("newRuleDomain") as HTMLInputElement;
    const validationError = validateCustomRulePattern(input.value, customRules);
    if (validationError) {
      errorEl.textContent = validationError;
      return;
    }
    const domain = normalizeCustomRuleDomain(input.value)!; // validated above, so this can't be null here
    const newRule: CustomRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      domain,
      enabled: true,
      createdAt: Date.now()
    };
    const result = await send<{ error?: string }>({ type: "SET_CUSTOM_RULES", rules: [...customRules, newRule] });
    if (result?.error) {
      errorEl.textContent = result.error;
      return;
    }
    void renderPremium();
  });

  content.querySelectorAll<HTMLElement>("[data-rule-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.ruleToggle!;
      const next = customRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
      await send({ type: "SET_CUSTOM_RULES", rules: next });
      void renderPremium();
    });
  });

  content.querySelectorAll<HTMLElement>("[data-rule-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.ruleDelete!;
      const next = customRules.filter((r) => r.id !== id);
      await send({ type: "SET_CUSTOM_RULES", rules: next });
      void renderPremium();
    });
  });

  document.getElementById("activateBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("licenseInput") as HTMLInputElement;
    const errorEl = document.getElementById("licenseError")!;
    errorEl.textContent = "";
    // NOTE: chrome.runtime.sendMessage resolves normally even when the
    // background responded with { error }; it only rejects on a transport
    // failure (e.g. no listener). So the failure path here is a field
    // check on the resolved value, not a try/catch around the call.
    const result = await send<{ error?: string } | SubscriptionState>({ type: "ACTIVATE_LICENSE", key: input.value });
    if (result && "error" in result && result.error) {
      errorEl.textContent = result.error;
      return;
    }
    await refreshPlanBadge();
    void renderPremium();
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await send({ type: "LOGOUT" });
    await refreshPlanBadge();
    void renderPremium();
  });

  document.getElementById("manageSubBtn")?.addEventListener("click", () => {
    openModal(`
      <h2>Manage Subscription</h2>
      <p style="font-size:13px;">Subscription management requires a connected billing backend, which is not configured in this build. No purchase or renewal has been simulated.</p>
      <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
    `);
  });

  content.querySelectorAll<HTMLElement>("[data-profile]").forEach((card) => {
    card.addEventListener("click", async () => {
      const profileId = card.dataset.profile as UserSettings["activeProfile"];
      const profile = PROTECTION_PROFILES.find((p) => p.id === profileId);
      if (profile?.isPremium && !premium) {
        openModal(`
          <h2>Pro Feature</h2>
          <p style="font-size:13px;">The "${profile.name}" profile is part of ShieldGuard Pro. Activate a license to use it.</p>
          <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
        `);
        return;
      }
      // The UI check above is only a fast-path for a good user experience --
      // the actual enforcement happens in the background service worker's
      // SET_PROFILE handler, which independently re-checks entitlement and
      // returns an error rather than applying the profile if it's wrong.
      const result = await send<{ error?: string; message?: string }>({ type: "SET_PROFILE", profile: profileId });
      if (result?.error === "premium_required") {
        openModal(`
          <h2>Pro Feature</h2>
          <p style="font-size:13px;">${escapeHtml(result.message ?? "This profile requires ShieldGuard Pro.")}</p>
          <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
        `);
        return;
      }
      void renderPremium();
    });
  });
}

// ---------------------------------------------------------------------------
// More
// ---------------------------------------------------------------------------

async function renderMore(): Promise<void> {
  content.innerHTML = `
    <h1 class="page-title">${t("moreTitle", "More")}</h1>
    <p class="page-subtitle">${t("moreSubtitle", "Additional tools and information.")}</p>

    <div class="more-grid">
      <div class="more-tile" data-action="help" role="button" tabindex="0">${t("helpCenter", "Help Center")}<p>Guides and FAQ.</p></div>
      <div class="more-tile" data-action="privacy" role="button" tabindex="0">${t("privacyPolicy", "Privacy Policy")}<p>What ShieldGuard does and doesn't collect.</p></div>
      <div class="more-tile" data-action="security" role="button" tabindex="0">${t("security", "Security")}<p>Permissions and architecture overview.</p></div>
      <div class="more-tile" data-action="about" role="button" tabindex="0">${t("aboutShieldGuard", "About ShieldGuard")}<p>Version and product info.</p></div>
      <div class="more-tile" data-action="report" role="button" tabindex="0">${t("reportProblem", "Report a Problem")}<p>Tell us about a broken site.</p></div>
      <div class="more-tile" data-action="export" role="button" tabindex="0">${t("exportSettings", "Export Settings")}<p>Save your configuration to a file.</p></div>
      <div class="more-tile" data-action="import" role="button" tabindex="0">${t("importSettings", "Import Settings")}<p>Restore configuration from a file.</p></div>
      <div class="more-tile" data-action="reset" role="button" tabindex="0">${t("resetExtension", "Reset Extension")}<p>Restore all defaults.</p></div>
      <div class="more-tile" data-action="feedback" role="button" tabindex="0">${t("feedback", "Feedback")}<p>Tell us what to improve.</p></div>
      <div class="more-tile" data-action="health" role="button" tabindex="0">Protection Health<p>Diagnostics and configuration status.</p></div>
      <div class="more-tile" data-action="share" role="button" tabindex="0">${t("shareShieldGuard", "Share ShieldGuard")}<p>Tell a friend.</p></div>
    </div>

    <div class="section">
      <h2>Get ShieldGuard</h2>
      <p class="page-subtitle" style="margin-top:-4px;">ShieldGuard on other browsers and platforms.</p>
      <div class="platform-grid">
        ${platformTile("Chrome Extension", "Currently installed and active in this browser.", "available")}
        ${platformTile("Edge Extension", "A Chromium-based Edge build is planned.", "soon")}
        ${platformTile("Firefox Extension", "A Firefox build using the WebExtensions API is planned.", "soon")}
        ${platformTile("Android App", "A dedicated mobile app is planned.", "soon")}
        ${platformTile("Desktop App", "A standalone desktop app is planned.", "soon")}
      </div>
    </div>
    <input type="file" id="importFileInput" accept="application/json" hidden />
  `;

  content.querySelector(".more-grid")!.addEventListener("click", (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!tile) return;
    void handleMoreAction(tile.dataset.action!);
  });
}

function platformTile(name: string, note: string, status: "available" | "soon"): string {
  const badge =
    status === "available"
      ? `<span class="platform-badge available">Installed</span>`
      : `<span class="platform-badge soon">Coming Soon</span>`;
  return `
    <div class="platform-tile">
      <div class="platform-tile-head">
        <strong>${name}</strong>
        ${badge}
      </div>
      <p>${note}</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Protection Health (diagnostics)
// ---------------------------------------------------------------------------

function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDaysOfWeek(days: number[]): string {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d))) return "Weekdays";
  if (sorted.length === 2 && [0, 6].every((d) => sorted.includes(d))) return "Weekends";
  return sorted.map((d) => labels[d]).join(", ");
}

function openAddScheduleModal(existing: ScheduleRule[]): void {
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  openModal(`
    <h2>Add Schedule</h2>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12.5px;">Label
        <input type="text" id="schLabel" placeholder="e.g. Work hours" style="width:100%;" />
      </label>
      <label style="font-size:12.5px;">Days
        <div class="btn-row" style="margin-top:4px;">
          ${dayLabels.map((d, i) => `<label style="font-size:12px;"><input type="checkbox" class="schDay" value="${i}" ${i >= 1 && i <= 5 ? "checked" : ""}/> ${d}</label>`).join(" ")}
        </div>
      </label>
      <label style="font-size:12.5px;">Start time
        <input type="time" id="schStart" value="09:00" style="width:100%;" />
      </label>
      <label style="font-size:12.5px;">End time
        <input type="time" id="schEnd" value="17:00" style="width:100%;" />
      </label>
      <label style="font-size:12.5px;">Profile
        <select id="schProfile" style="width:100%;">
          ${PROTECTION_PROFILES.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
        </select>
      </label>
    </div>
    <p id="schError" style="color:var(--sg-red);font-size:12.5px;"></p>
    <div class="modal-close-row">
      <button class="btn btn-secondary btn-sm" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-sm" id="schSaveBtn">Save Schedule</button>
    </div>
  `);

  document.getElementById("schSaveBtn")?.addEventListener("click", async () => {
    const label = (document.getElementById("schLabel") as HTMLInputElement).value.trim();
    const days = Array.from(document.querySelectorAll<HTMLInputElement>(".schDay:checked")).map((el) => Number(el.value));
    const startStr = (document.getElementById("schStart") as HTMLInputElement).value;
    const endStr = (document.getElementById("schEnd") as HTMLInputElement).value;
    const profile = (document.getElementById("schProfile") as HTMLSelectElement).value as UserSettings["activeProfile"];
    const errorEl = document.getElementById("schError")!;

    if (days.length === 0) {
      errorEl.textContent = "Pick at least one day.";
      return;
    }
    const [startH = 0, startM = 0] = startStr.split(":").map(Number);
    const [endH = 0, endM = 0] = endStr.split(":").map(Number);
    const startMinute = startH * 60 + startM;
    const endMinute = endH * 60 + endM;
    if (startMinute === endMinute) {
      errorEl.textContent = "Start and end time can't be the same.";
      return;
    }

    const newRule: ScheduleRule = {
      id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: label || "Untitled schedule",
      enabled: true,
      daysOfWeek: days,
      startMinute,
      endMinute,
      profile
    };
    const result = await send<{ error?: string }>({ type: "SET_SCHEDULES", schedules: [...existing, newRule] });
    if (result?.error) {
      errorEl.textContent = result.error;
      return;
    }
    closeModal();
    void renderPremium();
  });
}

async function renderProtectionHealth(): Promise<void> {
  const diag = await send<ProtectionDiagnostics>({ type: "GET_DIAGNOSTICS" });

  content.innerHTML = `
    <h1 class="page-title">Protection Health</h1>
    <p class="page-subtitle">Diagnostic status for support and troubleshooting.</p>

    ${
      diag.warnings.length > 0
        ? `<div class="section" style="border-color:var(--sg-red, #e5484d);">
            <h2>Configuration Warnings</h2>
            <ul class="reasons">${diag.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
          </div>`
        : `<div class="section"><p class="empty-state">No configuration problems detected.</p></div>`
    }

    <div class="section">
      <h2>Version</h2>
      <div class="settings-row"><div class="settings-row-label">ShieldGuard version</div><div>${escapeHtml(diag.version)}</div></div>
      <div class="settings-row"><div class="settings-row-label">Manifest version</div><div>MV${diag.manifestVersion}</div></div>
      <div class="settings-row"><div class="settings-row-label">Minimum Chrome version</div><div>${escapeHtml(diag.minimumChromeVersion)}</div></div>
      <div class="settings-row"><div class="settings-row-label">Plan</div><div>${diag.plan === "pro" ? "Pro" : "Free"}</div></div>
    </div>

    <div class="section">
      <h2>Protection Status</h2>
      <div class="settings-row"><div class="settings-row-label">Protection enabled</div><div>${diag.protectionEnabled ? "🟢 Yes" : "⚪ No"}</div></div>
      <div class="settings-row"><div class="settings-row-label">Active profile</div><div>${escapeHtml(diag.activeProfile)}</div></div>
      <div class="settings-row"><div class="settings-row-label">Background service worker</div><div>🟢 Running (responded to this request)</div></div>
    </div>

    <div class="section">
      <h2>Rulesets</h2>
      ${diag.rulesets
        .map(
          (r) => `
        <div class="settings-row">
          <div class="settings-row-label">${escapeHtml(r.id)}</div>
          <div>${r.enabled ? "🟢 Enabled" : "⚪ Disabled"} — ${r.ruleCount === null ? "rule count unavailable" : `${r.ruleCount} rules`}</div>
        </div>`
        )
        .join("")}
      <div class="settings-row"><div class="settings-row-label">Per-site dynamic exception rules</div><div>${diag.dynamicSiteExceptionRuleCount}</div></div>
      <div class="settings-row"><div class="settings-row-label">Active custom block rules</div><div>${diag.dynamicCustomRuleCount}</div></div>
    </div>

    <div class="section">
      <h2>Activity &amp; Storage</h2>
      <div class="settings-row"><div class="settings-row-label">Last protection event</div><div>${
        diag.lastProtectionEvent
          ? `${escapeHtml(diag.lastProtectionEvent.category)} on ${escapeHtml(diag.lastProtectionEvent.domain)}, ${new Date(diag.lastProtectionEvent.timestamp).toLocaleString()}`
          : "None recorded"
      }</div></div>
      <div class="settings-row"><div class="settings-row-label">Events stored</div><div>${diag.eventCount}</div></div>
      <div class="settings-row"><div class="settings-row-label">Sites configured</div><div>${diag.siteCount}</div></div>
      <div class="settings-row"><div class="settings-row-label">Storage used</div><div>${(diag.storageBytesInUse / 1024).toFixed(1)} KB</div></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary btn-sm" id="copyDiagnostics">Copy diagnostics</button>
    </div>
  `;

  document.getElementById("copyDiagnostics")?.addEventListener("click", async () => {
    const text = JSON.stringify(diag, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById("copyDiagnostics")!;
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch {
      openModal(`
        <h2>Diagnostics</h2>
        <p style="font-size:12px;">Clipboard access was denied. Copy the text below manually.</p>
        <textarea readonly style="width:100%;height:220px;font-family:monospace;font-size:11px;">${escapeHtml(text)}</textarea>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
    }
  });
}

async function handleMoreAction(action: string): Promise<void> {
  switch (action) {
    case "health":
      location.hash = "protection-health";
      return;
    case "help":
      openModal(`
        <h2>Help Center</h2>
        <p style="font-size:13px;">ShieldGuard blocks unwanted popups, redirects, ads, and trackers directly in your browser. Use <strong>Control Center</strong> to see what's been blocked, <strong>Content Filter</strong> to fine-tune categories, and <strong>Site Manager</strong> to trust or pause protection per site.</p>
        <p style="font-size:12.5px;color:var(--sg-muted);">Note: Chrome does not allow any extension to guarantee that a popup tab never briefly appears before being closed — ShieldGuard detects and closes unwanted tabs as fast as the platform allows.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    case "privacy":
      openModal(`
        <h2>Privacy Policy</h2>
        <p style="font-size:13px;">ShieldGuard stores all settings, site preferences, and blocked-event history locally on your device using chrome.storage.local. ShieldGuard does not collect passwords, form contents, keystrokes, screenshots, private browsing contents, or your general browsing history, and does not sell any data.</p>
        <p style="font-size:13px;">An optional, off-by-default cloud reputation check can be enabled in Settings → Privacy. When enabled, only the domain being checked is sent — never page content or personal data.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    case "security":
      openModal(`
        <h2>Security &amp; Permissions</h2>
        <ul class="reasons">
          <li><strong>storage</strong> — save your settings and local statistics.</li>
          <li><strong>tabs</strong> — read the active tab's domain and close unwanted popup tabs.</li>
          <li><strong>webNavigation</strong> — observe navigation events to detect popups and redirect chains.</li>
          <li><strong>declarativeNetRequest</strong> — apply on-device blocking rules without inspecting your traffic content.</li>
          <li><strong>alarms</strong> — run periodic retention cleanup and summary checks.</li>
          <li><strong>notifications</strong> — show an occasional blocked-events summary.</li>
        </ul>
        <p style="font-size:12.5px;color:var(--sg-muted);">No host permissions are requested. ShieldGuard never downloads or executes remote code.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    case "about":
      openModal(`
        <h2>About ShieldGuard</h2>
        <p style="font-size:13px;">ShieldGuard — Browse freely. Shield the unwanted.</p>
        <p style="font-size:12.5px;color:var(--sg-muted);">Version ${chrome.runtime.getManifest().version}</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    case "report":
      showReportModal();
      return;
    case "export": {
      const payload = await send<string>({ type: "EXPORT_SETTINGS" });
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shieldguard-settings.json";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    case "import": {
      const input = document.getElementById("importFileInput") as HTMLInputElement;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        // Same note as ACTIVATE_LICENSE above: send() resolves with
        // { error } on a validation failure rather than rejecting, so we
        // must check the field, not rely on catch.
        const result = await send<{ error?: string; ok?: boolean }>({ type: "IMPORT_SETTINGS", payload: text });
        if (result?.error) {
          openModal(`<h2>Import failed</h2><p style="font-size:13px;">${escapeHtml(result.error)}</p><div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>`);
          return;
        }
        openModal(`<h2>Import complete</h2><p style="font-size:13px;">Your settings were imported successfully.</p><div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>`);
      };
      input.click();
      return;
    }
    case "reset":
      openModal(`
        <h2>Reset Extension</h2>
        <p style="font-size:13px;">This will restore all ShieldGuard settings, site preferences, and history to their defaults. This cannot be undone.</p>
        <div class="modal-close-row">
          <button class="btn btn-secondary btn-sm" data-close-modal>Cancel</button>
          <button class="btn btn-danger btn-sm" id="confirmReset">Reset Everything</button>
        </div>
      `);
      document.getElementById("confirmReset")?.addEventListener("click", async () => {
        await send({ type: "RESET_EXTENSION" });
        closeModal();
        void navigate();
      });
      return;
    case "feedback":
      openModal(`
        <h2>Feedback</h2>
        <p style="font-size:13px;">Have an idea or found something confusing? Use "Report a Problem" for site-specific issues, or the Chrome Web Store review page once ShieldGuard is published there.</p>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      return;
    case "share":
      openModal(`
        <h2>Share ShieldGuard</h2>
        <div class="btn-row" style="flex-direction:column;">
          <button class="btn btn-secondary btn-sm" id="copyLink">Copy Link</button>
          <button class="btn btn-secondary btn-sm" id="shareX">Share on X</button>
          <button class="btn btn-secondary btn-sm" id="shareFb">Share on Facebook</button>
        </div>
        <div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>
      `);
      document.getElementById("copyLink")?.addEventListener("click", () => {
        void navigator.clipboard.writeText("https://chromewebstore.google.com/");
      });
      document.getElementById("shareX")?.addEventListener("click", () => {
        window.open("https://twitter.com/intent/tweet?text=Check%20out%20ShieldGuard", "_blank", "noopener");
      });
      document.getElementById("shareFb")?.addEventListener("click", () => {
        window.open("https://www.facebook.com/sharer/sharer.php?u=https://chromewebstore.google.com/", "_blank", "noopener");
      });
      return;
  }
}

function showReportModal(): void {
  openModal(`
    <h2>Report a Problem</h2>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12.5px;">Website
        <input type="text" id="reportDomain" placeholder="example.com" style="width:100%;" />
      </label>
      <label style="font-size:12.5px;">Problem
        <select id="reportProblem" style="width:100%;">
          <option value="popup_blocked_incorrectly">Popup blocked incorrectly</option>
          <option value="ad_incorrectly_removed">Ad incorrectly removed</option>
          <option value="website_broken">Website broken</option>
          <option value="redirect_incorrectly_blocked">Redirect incorrectly blocked</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label style="font-size:12.5px;">Description
        <textarea id="reportDesc" rows="3" style="width:100%;"></textarea>
      </label>
    </div>
    <div class="modal-close-row">
      <button class="btn btn-secondary btn-sm" data-close-modal>Cancel</button>
      <button class="btn btn-primary btn-sm" id="sendReport">Send</button>
    </div>
  `);
  document.getElementById("sendReport")?.addEventListener("click", async () => {
    const domain = (document.getElementById("reportDomain") as HTMLInputElement).value;
    const problem = (document.getElementById("reportProblem") as HTMLSelectElement).value as
      | "popup_blocked_incorrectly"
      | "ad_incorrectly_removed"
      | "website_broken"
      | "redirect_incorrectly_blocked"
      | "other";
    const description = (document.getElementById("reportDesc") as HTMLTextAreaElement).value;
    await send({ type: "REPORT_BROKEN_SITE", report: { domain, problem, description } });
    openModal(`<h2>Thanks!</h2><p style="font-size:13px;">Your report was saved locally. ShieldGuard does not yet have a backend to transmit reports automatically.</p><div class="modal-close-row"><button class="btn btn-primary btn-sm" data-close-modal>Close</button></div>`);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
  applyTheme(settings.theme);
  applyReducedMotion(settings.reducedMotion);
  await localizeStaticChrome();
  await refreshPlanBadge();
  await navigate();
}

void boot();
