import { describe, expect, it } from "vitest";
import { buildActivity, decodeFrames, encodeFrame, episodeLabel } from "./discord";

const log = JSON.stringify({
  sessions: [
    { id: "a", date: "2026-11-02", minutes: 30, category: "Anime & TV", title: "", comprehension: null },
    { id: "b", date: "2026-11-03", minutes: 45, category: "Anime & TV", title: "", comprehension: null },
    { id: "c", date: "2026-11-04", minutes: 20, category: "Anime & TV", title: "", comprehension: null },
  ],
  settings: { weeklyGoalHours: 7, priorHours: 100 },
});
const now = new Date(2026, 10, 4, 21, 0);

describe("buildActivity", () => {
  it("shows the episode and stats that include unlogged watching", () => {
    const activity = buildActivity({ show: "Frieren", episode: "Episode 5", playing: true, activeMs: 40 * 60_000 }, log, now);
    expect(activity.details).toBe("Frieren · Episode 5");
    expect(activity.state).toBe("🔥 3 days · 1h today · 102h total");
    expect(activity.timestamps).toEqual({ start: now.getTime() - 40 * 60_000 });
    expect(activity.assets).toEqual({
      large_image: "hitaru",
      large_text: "浸る Hitaru · 102 hours of Japanese immersion",
      small_image: "playing",
      small_text: "Playing",
    });
  });

  it("counts today toward the streak once watching starts", () => {
    const yesterday = JSON.stringify({ sessions: [{ date: "2026-11-03", minutes: 10 }] });
    expect(buildActivity({ show: "X", episode: null, playing: true, activeMs: 0 }, yesterday, now).state).toMatch(/^🔥 1 day ·/);
    expect(buildActivity({ show: "X", episode: null, playing: true, activeMs: 60_000 }, yesterday, now).state).toMatch(/^🔥 2 days ·/);
  });

  it("marks a pause and drops the elapsed timer", () => {
    const activity = buildActivity({ show: "Frieren", episode: null, playing: false, activeMs: 0 }, null, now);
    expect(activity.details).toBe("Paused: Frieren");
    expect(activity.state).toBe("0m today · 0h total");
    expect(activity.timestamps).toBeUndefined();
    expect(activity.assets).toMatchObject({ small_image: "paused", small_text: "Paused" });
  });

  it("keeps fields within Discord's length limits", () => {
    const activity = buildActivity({ show: "あ".repeat(200), episode: null, playing: true, activeMs: 0 }, null, now);
    expect(activity.details).toHaveLength(128);
    expect(buildActivity({ show: "X", episode: null, playing: true, activeMs: 0 }, null, now).details).toHaveLength(2);
  });
});

describe("episodeLabel", () => {
  it.each([
    ["Show S01E05", "S1 E5"],
    ["[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD1234]", "Episode 5"],
    ["Episode 12", "Episode 12"],
    ["Ep.3", "Episode 3"],
    ["第7話", "Episode 7"],
    ["Movie (2019)", "Movie"],
  ])("%s → %s", (name, label) => expect(episodeLabel(name)).toBe(label));
});

describe("IPC frames", () => {
  it("round-trips frames split across chunks", () => {
    const both = Buffer.concat([encodeFrame(1, { evt: "READY" }), encodeFrame(3, { n: "日本" })]);
    const first = decodeFrames(both.subarray(0, 25));
    expect(first.frames).toEqual([{ op: 1, payload: { evt: "READY" } }]);
    const second = decodeFrames(Buffer.concat([first.rest, both.subarray(25)]));
    expect(second.frames).toEqual([{ op: 3, payload: { n: "日本" } }]);
    expect(second.rest).toHaveLength(0);
  });
});
