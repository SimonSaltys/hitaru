import { addDays, fromKey, startOfWeek, toKey } from "./dates";
import type { Session } from "./types";

export const MILESTONES = [
  10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
];

export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function minutesByDay(sessions: Session[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const s of sessions) days.set(s.date, (days.get(s.date) ?? 0) + s.minutes);
  return days;
}

export function totalMinutes(sessions: Session[], priorHours = 0): number {
  return sessions.reduce((sum, s) => sum + s.minutes, priorHours * 60);
}

/**
 * The current streak survives until a full day is missed: having nothing logged
 * yet today doesn't break it, so it never reads 0 first thing in the morning.
 */
export function streaks(sessions: Session[], today: Date): { current: number; longest: number } {
  const days = [...minutesByDay(sessions).keys()].filter((k) => k <= toKey(today)).sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of days) {
    run = previous !== null && toKey(addDays(fromKey(previous), 1)) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }

  const logged = new Set(days);
  let cursor = logged.has(toKey(today)) ? today : addDays(today, -1);
  let current = 0;
  while (logged.has(toKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export interface WeekStats {
  start: Date;
  minutes: number;
  /** Time-weighted average of rated sessions; null if none were rated. */
  comprehension: number | null;
}

/** The last `count` weeks (Monday start), oldest first, including the current one. */
export function weeklyStats(sessions: Session[], today: Date, count: number): WeekStats[] {
  const current = startOfWeek(today);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(current, (i - count + 1) * 7);
    const from = toKey(start);
    const to = toKey(addDays(start, 7));
    const inWeek = sessions.filter((s) => s.date >= from && s.date < to);
    const rated = inWeek.filter((s) => s.comprehension !== null);
    const ratedMinutes = rated.reduce((sum, s) => sum + s.minutes, 0);
    return {
      start,
      minutes: inWeek.reduce((sum, s) => sum + s.minutes, 0),
      comprehension:
        ratedMinutes > 0
          ? rated.reduce((sum, s) => sum + s.minutes * s.comprehension!, 0) / ratedMinutes
          : null,
    };
  });
}

/**
 * Average minutes per day over the last 30 days. Someone who started a week ago
 * is averaged over that week, not diluted by days before they began.
 */
export function dailyPace(sessions: Session[], today: Date): number {
  const dates = sessions.map((s) => s.date).filter((d) => d <= toKey(today));
  if (dates.length === 0) return 0;
  const first = fromKey(dates.reduce((a, b) => (a < b ? a : b)));
  const sinceFirst = Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1;
  const window = Math.min(30, Math.max(1, sinceFirst));
  const from = toKey(addDays(today, -(window - 1)));
  const minutes = sessions
    .filter((s) => s.date >= from && s.date <= toKey(today))
    .reduce((sum, s) => sum + s.minutes, 0);
  return minutes / window;
}

export function nextMilestone(hours: number): { previous: number; next: number } | null {
  const index = MILESTONES.findIndex((m) => m > hours);
  if (index === -1) return null;
  return { previous: MILESTONES[index - 1] ?? 0, next: MILESTONES[index]! };
}

/** The highest milestone reached by going from `before` to `after` hours, if any. */
export function crossedMilestone(before: number, after: number): number | null {
  const crossed = MILESTONES.filter((m) => before < m && after >= m);
  return crossed[crossed.length - 1] ?? null;
}

export function rankBy(
  sessions: Session[],
  key: (s: Session) => string,
): { name: string; minutes: number }[] {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    const name = key(s);
    if (name) totals.set(name, (totals.get(name) ?? 0) + s.minutes);
  }
  return [...totals]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}
