import { describe, expect, it } from "vitest";
import type { CueToken } from "../../bridge/tokens";
import { buildKnownWords } from "./known";
import { wordsToLearn } from "./mining";

const word = (lemma: string, counts = true): CueToken => ({
  from: 0, to: lemma.length, surface: lemma, lemma, reading: "ー", counts,
});

const known = buildKnownWords([{ word: "犬", reading: "いぬ" }]);
const inAnki = buildKnownWords([{ word: "犬", reading: "いぬ" }, { word: "猫", reading: "ねこ" }]);

describe("wordsToLearn", () => {
  it("ranks by use and leaves out known words, words with cards, and grammar", () => {
    const { words, withCards } = wordsToLearn(
      [[word("山")], [word("川"), word("犬")], [word("川"), word("猫"), word("は", false)]],
      known,
      inAnki,
    );
    expect(words.map((w) => [w.lemma, w.count])).toEqual([["川", 2], ["山", 1]]);
    expect(withCards).toBe(1);
  });

  it("picks the line with the fewest other unknown words", () => {
    const { words } = wordsToLearn(
      [[word("川"), word("山"), word("空")], [word("川"), word("犬")], [word("川")]],
      known,
      inAnki,
    );
    expect(words.find((w) => w.lemma === "川")?.cue).toBe(1);
  });
});
