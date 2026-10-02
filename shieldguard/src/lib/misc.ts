import type { ProtectionEvent, RetentionPolicy } from "./types";

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatBadgeCount(n: number): string {
  if (n <= 0) return "";
  if (n > 99) return "99+";
  return String(n);
}

const RETENTION_MS: Record<Exclude<RetentionPolicy, "forever" | "disabled">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000
};

/** Returns events that should be KEPT under the given retention policy. */
export function applyRetention(
  events: ProtectionEvent[],
  policy: RetentionPolicy,
  now: number = Date.now()
): ProtectionEvent[] {
  if (policy === "forever") return events;
  if (policy === "disabled") return [];
  const cutoff = now - RETENTION_MS[policy];
  return events.filter((e) => e.timestamp >= cutoff);
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), waitMs);
  };
}
