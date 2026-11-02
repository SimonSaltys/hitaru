import { describe, expect, it } from "vitest";
import { activeWord, flowLines, furiganaPieces, textPieces } from "./words";

const words = [
  { from: 4, to: 6, start: 1, end: 1.5 },
  { from: 6, to: 7, start: 1.5, end: 2 },
  { from: 8, to: 10, start: 3, end: 3.5 },
];

describe("activeWord", () => {
  it("finds the word being spoken", () => {
    expect(activeWord(words, 1.2)).toBe(0);
    expect(activeWord(words, 1.5)).toBe(1);
    expect(activeWord(words, 3.2)).toBe(2);
  });

  it("is -1 before the first word and during a real pause", () => {
    expect(activeWord(words, 0.5)).toBe(-1);
    expect(activeWord(words, 2.5)).toBe(-1);
  });

  it("holds briefly past a word's end", () => {
    expect(activeWord(words, 2.05)).toBe(1);
  });
});

describe("textPieces", () => {
  it("rebuilds the whole cue around its words", () => {
    const text = "（リン）ほんと だね！";
    const pieces = textPieces(text, words);
    expect(pieces.map((p) => p.text).join("")).toBe(text);
    expect(pieces.map((p) => p.word)).toEqual([null, 0, 1, null, 2, null]);
  });
});

describe("furiganaPieces", () => {
  it("separates inline readings from the words they belong to", () => {
    expect(furiganaPieces("犬山(いぬやま)さん 焚(た)き火")).toEqual([
      { text: "犬山", reading: "いぬやま" },
      { text: "さん " },
      { text: "焚", reading: "た" },
      { text: "き火" },
    ]);
  });

  it("leaves speaker labels and other brackets alone", () => {
    expect(furiganaPieces("（千明）はい (笑)")).toEqual([{ text: "（千明）はい (笑)" }]);
  });
});

describe("flowLines", () => {
  it("joins lines but keeps a new speaker on their own line", () => {
    expect(flowLines("（あおい）\n斉藤さん\n燃えるで")).toBe("（あおい） 斉藤さん 燃えるで");
    expect(flowLines("ありがとう\n（千明）はい")).toBe("ありがとう\n（千明）はい");
  });

  it("keeps character positions unchanged", () => {
    const text = "あ\nい";
    expect(flowLines(text).length).toBe(text.length);
  });
});
