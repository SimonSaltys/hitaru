import { describe, expect, it } from "vitest";
import {
  crossedMilestone,
  dailyPace,
  formatMinutes,
  nextMilestone,
  streaks,
  totalMinutes,
  weeklyStats,
} from "./stats";
import { fromKey, startOfWeek, toKey } from "./dates";
import type { Session } from "./types";

function session(date: string, minutes = 30, comprehension: number | null = null): Session {
  return { id: `${date}-${minutes}`, date, minutes, category: "Anime & TV", title: "", comprehension };
}

// A Wednesday.
const today = fromKey("2026-10-28");

describe("dates", () => {
  it("round-trips across a DST change", () => {
    expect(toKey(fromKey("2026-03-29"))).toBe("2026-03-29");
    expect(toKey(fromKey("2026-10-25"))).toBe("2026-10-25");
  });

  it("starts weeks on Monday, including from a Sunday", () => {
    expect(toKey(startOfWeek(fromKey("2026-10-28")))).toBe("2026-10-26");
    expect(toKey(startOfWeek(fromKey("2026-11-01")))).toBe("2026-10-26");
  });
});

describe("formatMinutes", () => {
  it("formats minutes and hours", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(125)).toBe("2h 5m");
  });
});

describe("totalMinutes", () => {
  it("includes prior hours", () => {
    expect(totalMinutes([session("2026-10-28", 30)], 2)).toBe(150);
  });
});

describe("streaks", () => {
  it("is zero with no sessions", () => {
    expect(streaks([], today)).toEqual({ current: 0, longest: 0 });
  });

  it("counts consecutive days ending today", () => {
    const s = [session("2026-10-26"), session("2026-10-27"), session("2026-10-28")];
    expect(streaks(s, today).current).toBe(3);
  });

  it("survives when today is not logged yet", () => {
    const s = [session("2026-10-26"), session("2026-10-27")];
    expect(streaks(s, today).current).toBe(2);
  });

  it("resets after a fully missed day but remembers the longest", () => {
    const s = [
      session("2026-10-20"),
      session("2026-10-21"),
      session("2026-10-22"),
      session("2026-10-28"),
    ];
    expect(streaks(s, today)).toEqual({ current: 1, longest: 3 });
  });

  it("counts several sessions on one day once", () => {
    expect(streaks([session("2026-10-28"), session("2026-10-28", 45)], today).current).toBe(1);
  });

  it("crosses month boundaries", () => {
    const s = [session("2026-09-30"), session("2026-10-01")];
    expect(streaks(s, fromKey("2026-10-01")).current).toBe(2);
  });
});

describe("weeklyStats", () => {
  it("buckets by Monday-start week, oldest first", () => {
    const weeks = weeklyStats(
      [session("2026-10-25", 10), session("2026-10-26", 20), session("2026-10-28", 30)],
      today,
      2,
    );
    expect(weeks.map((w) => w.minutes)).toEqual([10, 50]);
  });

  it("weights comprehension by time and ignores unrated sessions", () => {
    const [week] = weeklyStats(
      [session("2026-10-26", 30, 2), session("2026-10-27", 90, 4), session("2026-10-28", 500)],
      today,
      1,
    );
    expect(week?.comprehension).toBe(3.5);
  });

  it("reports null comprehension when nothing is rated", () => {
    expect(weeklyStats([session("2026-10-26")], today, 1)[0]?.comprehension).toBeNull();
  });
});

describe("dailyPace", () => {
  it("averages only over days since the first session", () => {
    expect(dailyPace([session("2026-10-27", 60)], today)).toBe(30);
  });

  it("uses a 30-day window for established logs", () => {
    const s = [session("2026-01-01", 9000), session("2026-10-28", 300)];
    expect(dailyPace(s, today)).toBe(10);
  });
});

describe("milestones", () => {
  it("finds the next milestone", () => {
    expect(nextMilestone(0)).toEqual({ previous: 0, next: 10 });
    expect(nextMilestone(100)).toEqual({ previous: 100, next: 150 });
    expect(nextMilestone(20000)).toBeNull();
  });

  it("reports the highest milestone crossed", () => {
    expect(crossedMilestone(9, 10)).toBe(10);
    expect(crossedMilestone(10, 11)).toBeNull();
    expect(crossedMilestone(9, 30)).toBe(25);
  });
});

describe("weeklyStats known words", () => {
  const session = (words: number, knownWords: number | null, date = "2026-11-02") => ({
    id: `${words}`, date, minutes: 10, category: "Anime & TV" as const, title: "", comprehension: null,
    stats: {
      episode: "E01", lines: 1, words, uniqueWords: words,
      understanding: knownWords === null ? null : { words, knownWords, lines: 1, knownLines: 0 },
    },
  });

  it("weights by words heard, and skips sessions with nothing measured", () => {
    const [week] = weeklyStats([session(10, 5), session(30, 3), session(99, null)], new Date(2026, 10, 3), 1);
    expect(week?.knownPercent).toBe(20);
  });

  it("is null for a week with no measurements", () => {
    const [week] = weeklyStats([session(99, null)], new Date(2026, 10, 3), 1);
    expect(week?.knownPercent).toBeNull();
  });
});
