// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { installFullChromeMock } from "./chrome-mock-full";

const SHELL_HTML = `
  <div class="shell">
    <aside class="sidebar">
      <nav aria-label="Main">
        <a href="#control-center" data-route="control-center">Control Center</a>
        <a href="#content-filter" data-route="content-filter">Content Filter</a>
        <a href="#site-manager" data-route="site-manager">Site Manager</a>
        <a href="#event-history" data-route="event-history">Event History</a>
        <a href="#settings" data-route="settings">Settings</a>
        <a href="#premium" data-route="premium">Premium / Pro</a>
        <a href="#more" data-route="more">More</a>
      </nav>
      <div class="sidebar-footer" id="sidebarPlanBadge">Free Plan</div>
    </aside>
    <main class="content" id="content"></main>
  </div>
  <div class="modal-backdrop" id="modalBackdrop" hidden>
    <div class="modal" id="modal"></div>
  </div>
`;

async function flush(): Promise<void> {
  // Let pending promise chains (chrome.runtime.sendMessage -> render) resolve.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function goTo(hash: string): void {
  location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
}

beforeAll(async () => {
  document.body.innerHTML = SHELL_HTML;
  await installFullChromeMock();
  await import("../src/dashboard/dashboard");
  await flush();
});

describe("dashboard SPA smoke test (real DOM code, real storage/statistics)", () => {
  it("boots to Control Center by default and renders real (zero) stats without throwing", async () => {
    const content = document.getElementById("content")!;
    expect(content.innerHTML).toContain("Control Center");
    expect(content.innerHTML).toContain("Threats Blocked");
    expect(content.innerHTML).toContain(">0<"); // real zero stats, not fabricated
  });

  it("navigates to Content Filter and renders all documented categories", async () => {
    goTo("content-filter");
    await flush();
    const content = document.getElementById("content")!;
    for (const name of ["Advertising", "Trackers", "Popups", "Redirects", "Annoyances", "Social Widgets", "Cryptocurrency Mining", "Scam / Malvertising"]) {
      expect(content.innerHTML).toContain(name);
    }
  });

  it("navigates to Site Manager without throwing", async () => {
    goTo("site-manager");
    await flush();
    const content = document.getElementById("content")!;
    expect(content.innerHTML).toContain("Site Manager");
  });

  it("navigates to Event History and shows the empty state for a fresh install", async () => {
    goTo("event-history");
    await flush();
    const content = document.getElementById("content")!;
    expect(content.innerHTML).toContain("Blocked Activity");
    expect(content.innerHTML).toContain("No matching events");
  });

  it("navigates to Settings and reflects real persisted settings", async () => {
    goTo("settings");
    await flush();
    const content = document.getElementById("content")!;
    expect(content.innerHTML).toContain("Popup Protection");
    expect(content.innerHTML).toContain("Redirect Protection");
  });

  it("navigates to Premium and shows the Free vs Pro comparison for a free-plan user", async () => {
    goTo("premium");
    await flush();
    const content = document.getElementById("content")!;
    expect(content.innerHTML).toContain("Free vs Pro");
    expect(content.innerHTML).toContain("Lockdown Mode");
  });

  it("navigates to More and lists all documented tiles", async () => {
    goTo("more");
    await flush();
    const content = document.getElementById("content")!;
    for (const label of ["Help Center", "Privacy Policy", "Report a Problem", "Export Settings", "Reset Extension", "Share ShieldGuard"]) {
      expect(content.innerHTML).toContain(label);
    }
  });

  it("toggling a Content Filter category persists through real storage", async () => {
    goTo("content-filter");
    await flush();
    const before = await (window as unknown as { chrome: typeof chrome }).chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    const adsToggleBefore = (before as { categories: { ads: boolean } }).categories.ads;

    const toggle = document.querySelector<HTMLElement>('.filter-category-row[data-key="ads"] .toggle')!;
    toggle.click();
    await flush();

    const after = await (window as unknown as { chrome: typeof chrome }).chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    const adsToggleAfter = (after as { categories: { ads: boolean } }).categories.ads;

    expect(adsToggleAfter).toBe(!adsToggleBefore);
  });
});
