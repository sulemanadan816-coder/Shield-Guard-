import type { DailyStatistics, EventCategory, ProtectionEvent } from "./types";
import { getStatsMap, setStatsMap } from "./storage";

export type StatsRange = "today" | "yesterday" | "7d" | "30d" | "all";

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

const EMPTY: Omit<DailyStatistics, "date"> = {
  popups: 0,
  ads: 0,
  redirects: 0,
  trackers: 0,
  overlays: 0,
  annoyances: 0
};

function categoryField(category: EventCategory): keyof typeof EMPTY {
  switch (category) {
    case "popup":
      return "popups";
    case "ad":
      return "ads";
    case "redirect":
      return "redirects";
    case "tracker":
      return "trackers";
    case "overlay":
      return "overlays";
    case "annoyance":
      return "annoyances";
  }
}

/** Increments today's real local counters for a blocked event. Never fabricated. */
export async function recordStatEvent(event: ProtectionEvent): Promise<void> {
  if (event.action !== "blocked") return;
  const stats = await getStatsMap();
  const date = isoDate(event.timestamp);
  const day: DailyStatistics = stats[date] ?? { date, ...EMPTY };
  const field = categoryField(event.category);
  day[field] += 1;
  stats[date] = day;
  await setStatsMap(stats);
}

export async function getStatisticsForRange(range: StatsRange): Promise<DailyStatistics> {
  const stats = await getStatsMap();
  const now = new Date();
  const dates: string[] = [];

  if (range === "today") {
    dates.push(isoDate(now.getTime()));
  } else if (range === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    dates.push(isoDate(y.getTime()));
  } else if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(isoDate(d.getTime()));
    }
  } else {
    dates.push(...Object.keys(stats));
  }

  const total: DailyStatistics = { date: range, ...EMPTY };
  for (const date of dates) {
    const day = stats[date];
    if (!day) continue;
    total.popups += day.popups;
    total.ads += day.ads;
    total.redirects += day.redirects;
    total.trackers += day.trackers;
    total.overlays += day.overlays;
    total.annoyances += day.annoyances;
  }
  return total;
}

export function totalBlocked(stats: DailyStatistics): number {
  return (
    stats.popups + stats.ads + stats.redirects + stats.trackers + stats.overlays + stats.annoyances
  );
}
