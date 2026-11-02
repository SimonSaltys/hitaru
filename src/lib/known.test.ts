import { describe, expect, it } from "vitest";
import type { CueToken } from "../../bridge/tokens";
import { buildKnownWords, isKnown, markKnown, percent, understanding } from "./known";

function token(surface: string, lemma: string, reading: string, counts = true): CueToken {
  return { from: 0, to: surface.length, surface, lemma, reading, counts };
}

const known = buildKnownWords([
  { word: "行く", reading: "いく" },
  { word: "何", reading: "なに・なん" },
  { word: "歯", reading: "は" },
  { word: "勉強する", reading: "べんきょうする" },
]);

describe("isKnown", () => {
  it("matches inflected words by dictionary form", () => {
    expect(isKnown(token("行っ", "行く", "いっ"), known)).toBe(true);
  });

  it("matches kana spellings by sound, with any of a card's readings", () => {
    expect(isKnown(token("なに", "なに", "なに"), known)).toBe(true);
    expect(isKnown(token("なん", "なん", "なん"), known)).toBe(true);
  });

  it("doesn't match a homophone written in kanji", () => {
    expect(isKnown(token("生く", "生く", "いく"), known)).toBe(false);
  });

  it("doesn't let a one-kana reading claim a particle", () => {
    expect(isKnown(token("は", "は", "は", false), known)).toBe(false);
  });

  it("matches a noun whose card includes する", () => {
    expect(isKnown(token("勉強", "勉強", "べんきょう"), known)).toBe(true);
  });
});

describe("understanding", () => {
  it("scores vocabulary only and counts fully known lines", () => {
    const go = token("行く", "行く", "いく");
    const particle = token("に", "に", "に", false);
    const unknown = token("犬", "犬", "いぬ");
    expect(understanding([[go, particle], [go, unknown], [particle]], known)).toEqual({
      words: 3,
      knownWords: 2,
      lines: 2,
      knownLines: 1,
    });
  });
});

describe("percent", () => {
  it("has no value for nothing", () => {
    expect(percent(0, 0)).toBe("—");
    expect(percent(1, 3)).toBe("33%");
  });
});

describe("markKnown", () => {
  it("splits timed words at known word boundaries and rebuilds the text", () => {
    const pieces = [{ text: "（リ）", word: null }, { text: "本だね", word: 0 }];
    const marked = markKnown(pieces, [{ from: 3, to: 4 }]);
    expect(marked).toEqual([
      { text: "（リ）", word: null, known: false },
      { text: "本", word: 0, known: true },
      { text: "だね", word: 0, known: false },
    ]);
  });

  it("marks a known word that spans several pieces", () => {
    const marked = markKnown([{ text: "勉", word: 0 }, { text: "強", word: 1 }], [{ from: 0, to: 2 }]);
    expect(marked.every((p) => p.known)).toBe(true);
  });
});
