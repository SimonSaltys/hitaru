import { beforeAll, describe, expect, it } from "vitest";
import { loadTokenizer, readableText, tokenizeCue } from "./tokens.ts";

describe("readableText", () => {
  it("drops inline readings and maps characters back to the original", () => {
    const { text, offsets } = readableText("焚(た)き火");
    expect(text).toBe("焚き火");
    expect(offsets).toEqual([0, 4, 5]);
  });

  it("replaces speaker labels with a space", () => {
    expect(readableText("（リン）ほんと").text).toBe(" ほんと");
  });
});

describe("tokenizeCue", () => {
  let tokenizer: Awaited<ReturnType<typeof loadTokenizer>>;
  beforeAll(async () => {
    tokenizer = await loadTokenizer();
  });

  it("finds dictionary forms", () => {
    const eaten = tokenizeCue(tokenizer, "パンを食べた").find((t) => t.surface === "食べ");
    expect(eaten?.lemma).toBe("食べる");
    expect(eaten?.counts).toBe(true);
  });

  it("doesn't score particles or names", () => {
    const tokens = tokenizeCue(tokenizer, "田中は本を読む");
    expect(tokens.find((t) => t.surface === "は")?.counts).toBe(false);
    expect(tokens.find((t) => t.surface === "田中")?.counts).toBe(false);
    expect(tokens.find((t) => t.surface === "本")?.counts).toBe(true);
  });

  it("doesn't score sounds", () => {
    expect(tokenizeCue(tokenizer, "うん").some((t) => t.counts)).toBe(false);
  });

  it("scores a one-kana verb stem", () => {
    const did = tokenizeCue(tokenizer, "勉強した").find((t) => t.surface === "し");
    expect(did?.lemma).toBe("する");
    expect(did?.counts).toBe(true);
  });

  it("points at the original text, past labels", () => {
    const text = "（リン）本だ";
    const book = tokenizeCue(tokenizer, text).find((t) => t.surface === "本")!;
    expect(text.slice(book.from, book.to)).toBe("本");
  });

  it("keeps a word's reading in its range", () => {
    const text = "犬山(いぬやま)さん";
    const first = tokenizeCue(tokenizer, text)[0]!;
    expect(text.slice(first.from, first.to)).toContain("(いぬやま)");
  });

  it("gives readings in hiragana", () => {
    expect(tokenizeCue(tokenizer, "本")[0]?.reading).toBe("ほん");
  });
});
