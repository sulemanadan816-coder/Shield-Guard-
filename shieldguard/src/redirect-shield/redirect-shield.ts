import type { RuntimeMessage } from "../lib/types";

async function send<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function $(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

function parseParams(): { dest: string; domain: string; reasons: string[] } {
  const params = new URLSearchParams(location.search);
  const dest = params.get("dest") ?? "";
  const domain = params.get("domain") ?? "";
  let reasons: string[] = [];
  try {
    const raw = JSON.parse(params.get("reasons") ?? "[]");
    if (Array.isArray(raw)) reasons = raw.filter((r): r is string => typeof r === "string");
  } catch {
    reasons = [];
  }
  return { dest, domain, reasons };
}

/** Only ever navigate onward to http(s) destinations we were actually given. */
function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function getCurrentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function render(): void {
  const { dest, domain, reasons } = parseParams();

  $("destinationText").textContent = dest || "(unknown destination)";
  const list = $("reasonsList");
  list.innerHTML = reasons.length
    ? reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")
    : "<li>Suspicious multi-domain redirect pattern</li>";

  $("goBackBtn").addEventListener("click", () => {
    history.back();
  });

  $("continueBtn").addEventListener("click", async () => {
    if (!isSafeHttpUrl(dest)) return;
    const tabId = await getCurrentTabId();
    if (typeof tabId === "number") {
      await send({ type: "ALLOW_REDIRECT_ONCE", tabId, url: dest });
    }
    window.location.href = dest;
  });

  $("trustBtn").addEventListener("click", async () => {
    if (!domain) return;
    await send({ type: "TRUST_SITE", domain });
    if (isSafeHttpUrl(dest)) {
      window.location.href = dest;
    }
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

render();
