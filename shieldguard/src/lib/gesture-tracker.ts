/**
 * Tracks the most recent trusted user gesture per tab, and recent popup
 * creation counts per opener tab. Lives only in the background service
 * worker's memory -- it is deliberately NOT persisted to storage since it
 * is a short-lived runtime signal, and service worker restarts simply
 * reset it to "no recent gesture", which is the safe default.
 */

interface GestureRecord {
  timestamp: number;
  targetOrigin: string;
}

interface PopupBurstRecord {
  timestamps: number[];
}

const BURST_WINDOW_MS = 10_000;

export class GestureTracker {
  private gestures = new Map<number, GestureRecord>();
  private bursts = new Map<number, PopupBurstRecord>();

  recordGesture(tabId: number, targetOrigin: string): void {
    this.gestures.set(tabId, { timestamp: Date.now(), targetOrigin });
  }

  msSinceLastGesture(tabId: number): number | null {
    const record = this.gestures.get(tabId);
    if (!record) return null;
    return Date.now() - record.timestamp;
  }

  recordPopupFromOpener(openerTabId: number): number {
    const now = Date.now();
    const existing = this.bursts.get(openerTabId) ?? { timestamps: [] };
    existing.timestamps = existing.timestamps.filter((t) => now - t < BURST_WINDOW_MS);
    existing.timestamps.push(now);
    this.bursts.set(openerTabId, existing);
    return existing.timestamps.length;
  }

  recentPopupCount(openerTabId: number): number {
    const now = Date.now();
    const existing = this.bursts.get(openerTabId);
    if (!existing) return 0;
    return existing.timestamps.filter((t) => now - t < BURST_WINDOW_MS).length;
  }

  clearTab(tabId: number): void {
    this.gestures.delete(tabId);
    this.bursts.delete(tabId);
  }
}

export const gestureTracker = new GestureTracker();
