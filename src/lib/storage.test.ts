import { describe, expect, it } from "vitest";
import { mergeSessions, parseData } from "./storage";
import type { Session } from "./types";

describe("parseData", () => {
  it("rejects files that aren't backups", () => {
    expect(() => parseData("{}")).toThrow();
    expect(() => parseData("not json")).toThrow();
  });

  it("drops invalid sessions and normalises fields", () => {
    const { sessions, settings } = parseData(
      JSON.stringify({
        sessions: [
          { id: "a", date: "2026-10-28", minutes: 30, category: "Unknown", comprehension: 9 },
          { id: "b", date: "yesterday", minutes: 30 },
          { id: "c", date: "2026-10-28", minutes: -5 },
        ],
      }),
    );
    expect(sessions).toEqual([
      { id: "a", date: "2026-10-28", minutes: 30, category: "Other", title: "", comprehension: null },
    ]);
    expect(settings.weeklyGoalHours).toBe(7);
  });
});

describe("mergeSessions", () => {
  it("keeps both sides and lets imports win on id", () => {
    const base: Session = {
      id: "a",
      date: "2026-10-28",
      minutes: 30,
      category: "Reading",
      title: "",
      comprehension: null,
    };
    const merged = mergeSessions([base], [{ ...base, minutes: 45 }, { ...base, id: "b" }]);
    expect(merged.map((s) => [s.id, s.minutes])).toEqual([
      ["a", 45],
      ["b", 30],
    ]);
  });
});
