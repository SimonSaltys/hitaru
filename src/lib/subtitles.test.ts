import { describe, expect, it } from "vitest";
import { cleanTitle, japaneseWords, latestLine, lineToStopAt, stepLine, subtitleStats } from "./subtitles";

describe("lineToStopAt", () => {
  const cues = [{ start: 10, end: 12 }, { start: 12, end: 14 }];

  it("stops just before a line ends, while it's still showing", () => {
    expect(lineToStopAt(cues, 11, null)).toBeNull();
    expect(lineToStopAt(cues, 11.97, null)).toBe(0);
  });

  it("lets playback carry on after stopping, then stops at the next line", () => {
    expect(lineToStopAt(cues, 11.98, 0)).toBeNull();
    expect(lineToStopAt(cues, 13.97, 0)).toBe(1);
  });

  it("does nothing between lines", () => {
    expect(lineToStopAt(cues, 20, null)).toBeNull();
  });
});

describe("line stepping", () => {
  const cues = [{ start: 10 }, { start: 20 }, { start: 30 }];

  it("steps from the current line", () => {
    expect(stepLine(cues, 21, 1)).toBe(2);
    expect(stepLine(cues, 21, -1)).toBe(0);
  });

  it("treats a gap as still being on the line that just ended", () => {
    expect(latestLine(cues, 25)).toBe(1);
    expect(stepLine(cues, 25, 1)).toBe(2);
  });

  it("moves on even if the last seek landed just short of its line", () => {
    expect(stepLine(cues, 19.99, 1)).toBe(2);
    expect(stepLine(cues, 19.99, -1)).toBe(0);
  });

  it("stops at the ends", () => {
    expect(stepLine(cues, 5, 1)).toBe(0);
    expect(stepLine(cues, 5, -1)).toBeNull();
    expect(stepLine(cues, 11, -1)).toBe(0);
    expect(stepLine(cues, 35, 1)).toBeNull();
  });
});

describe("japaneseWords", () => {
  it("segments Japanese and skips punctuation and Latin text", () => {
    const words = japaneseWords("今日は天気がいいです。OK!");
    expect(words).toContain("天気");
    expect(words).not.toContain("。");
    expect(words).not.toContain("OK");
  });
});

describe("subtitleStats", () => {
  it("counts words, unique words, and pace", () => {
    const stats = subtitleStats(["天気", "天気", "学校"], 60_000);
    expect(stats).toMatchObject({ words: 3, uniqueWords: 2, wordsPerMinute: 3 });
    expect(stats.topWords[0]).toEqual({ word: "天気", count: 2 });
  });

  it("doesn't count speaker labels or furigana readings", () => {
    const { topWords } = subtitleStats(["（千明(ちあき)）天気", "犬山(いぬやま)さん"], 60_000);
    const words = topWords.map((w) => w.word);
    expect(words).toContain("天気");
    expect(words).toContain("犬山");
    expect(words).not.toContain("千明");
    expect(words).not.toContain("ちあき");
    expect(words).not.toContain("いぬやま");
  });

  it("does not report a pace from under a minute of playback", () => {
    expect(subtitleStats(["天気"], 1000).wordsPerMinute).toBe(0);
  });

  it("leaves single-hiragana particles out of top words", () => {
    const { topWords } = subtitleStats(["天気は", "学校は"], 60_000);
    expect(topWords.map((w) => w.word)).not.toContain("は");
  });
});

describe("cleanTitle", () => {
  it("strips video extensions and handles a missing title", () => {
    expect(cleanTitle("Frieren 03.mkv")).toBe("Frieren 03");
    expect(cleanTitle("Dr. Stone")).toBe("Dr. Stone");
    expect(cleanTitle(null)).toBe("");
  });
});
