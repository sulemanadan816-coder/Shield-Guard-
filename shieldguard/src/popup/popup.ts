import type { CategoryToggleState, DailyStatistics, RuntimeMessage, UserSettings, SiteSettings } from "../lib/types";
import { t } from "../lib/i18n";

async function send<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setToggleUI(button: HTMLElement, on: boolean): void {
  button.setAttribute("aria-checked", String(on));
}

function localizeStatic(): void {
  $("siteLabelText").textContent = t("currentSite", "Current website");
  $("statsHeading").textContent = t("todaysProtection", "Today's Protection");
  $("openControlCenter").textContent = t("navControlCenter", "Control Center");
  $("openSettings").textContent = t("settings", "Settings");
  $("openUpgrade").textContent = t("upgradeToPro", "Upgrade to Pro");

  const catLabels: Record<string, string> = {
    popups: t("popupProtection", "Popup Protection"),
    redirects: t("redirectProtection", "Redirect Protection"),
    ads: t("adProtection", "Ad Protection"),
    trackers: t("trackerProtection", "Tracker Protection"),
    overlays: t("overlayProtection", "Overlay Protection")
  };
  for (const row of document.querySelectorAll<HTMLElement>(".category-row")) {
    const key = row.dataset.key;
    const label = row.querySelector<HTMLElement>(".cat-label");
    if (key && label && catLabels[key]) label.textContent = catLabels[key];
  }
}

async function render(): Promise<void> {
  const tab = await getActiveTab();
  const state = await send<{
    domain: string | null;
    settings: UserSettings;
    site?: SiteSettings;
    protectedNow: boolean;
  }>({ type: "GET_TAB_STATE", tabId: tab?.id ?? -1 });

  const today = await send<DailyStatistics>({ type: "GET_STATISTICS", range: "today" });

  $("siteDomain").textContent = state.domain ?? "—";

  const statusPill = $("statusPill");
  if (!state.settings.protectionEnabled) {
    statusPill.textContent = `⚪ ${t("protectionOff", "PROTECTION OFF")}`;
    statusPill.style.color = "var(--sg-muted)";
  } else if (state.protectedNow) {
    statusPill.textContent = `🟢 ${t("protected", "PROTECTED")}`;
    statusPill.style.color = "var(--sg-green)";
  } else {
    statusPill.textContent = `🟡 ${t("paused", "PAUSED")}`;
    statusPill.style.color = "var(--sg-amber)";
  }

  const mainSwitch = $("mainSwitch") as HTMLButtonElement;
  mainSwitch.setAttribute("aria-pressed", String(state.settings.protectionEnabled));
  $("mainSwitchLabel").textContent = state.settings.protectionEnabled
    ? t("protectionOn", "PROTECTION ON")
    : t("protectionOff", "PROTECTION OFF");

  const categories = state.site?.categories ?? state.settings.categories;
  for (const row of document.querySelectorAll<HTMLElement>(".category-row")) {
    const key = row.dataset.key as keyof CategoryToggleState;
    const toggle = row.querySelector<HTMLElement>(".toggle");
    if (toggle) setToggleUI(toggle, categories[key]);
  }

  $("statPopups").textContent = String(today.popups);
  $("statAds").textContent = String(today.ads);
  $("statRedirects").textContent = String(today.redirects);
  $("statTrackers").textContent = String(today.trackers);
}

async function toggleProtection(): Promise<void> {
  const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
  await send({ type: "SET_SETTINGS", settings: { protectionEnabled: !settings.protectionEnabled } });
  await render();
}

async function toggleCategory(key: keyof CategoryToggleState): Promise<void> {
  const settings = await send<UserSettings>({ type: "GET_SETTINGS" });
  const categories = { ...settings.categories, [key]: !settings.categories[key] };
  await send({ type: "SET_SETTINGS", settings: { categories } });
  await render();
}

function wireEvents(): void {
  $("mainSwitch").addEventListener("click", () => void toggleProtection());

  for (const row of document.querySelectorAll<HTMLElement>(".category-row")) {
    const key = row.dataset.key as keyof CategoryToggleState;
    row.querySelector(".toggle")?.addEventListener("click", () => void toggleCategory(key));
  }

  $("openControlCenter").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  $("openSettings").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#settings") });
  });
  $("openUpgrade").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#premium") });
  });
}

wireEvents();
localizeStatic();
void render();
