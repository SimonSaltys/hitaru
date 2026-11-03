import { describe, expect, it } from "vitest";
import { compactEntry, fileFromTar, pickEntry } from "./dictionary";
import { furigana, sentenceFields } from "./mining";
import type { CueToken } from "./tokens";

const token = (from: number, surface: string, lemma: string, reading: string): CueToken => ({
  from,
  to: from + surface.length,
  surface,
  lemma,
  reading,
  counts: true,
});

describe("furigana", () => {
  it("puts the reading over the kanji only", () => {
    expect(furigana("食べる", "たべる")).toBe(" 食[た]べる");
    expect(furigana("お茶", "おちゃ")).toBe("お 茶[ちゃ]");
    expect(furigana("焚き火", "たきび")).toBe(" 焚き火[たきび]");
  });

  it("leaves words without kanji alone", () => {
    expect(furigana("キャンプ", "きゃんぷ")).toBe("キャンプ");
  });
});

describe("sentenceFields", () => {
  it("bolds every form of the word and adds readings", () => {
    const text = "肉を食べた";
    const tokens = [token(0, "肉", "肉", "にく"), token(1, "を", "を", "を"), token(2, "食べ", "食べる", "たべ"), token(4, "た", "た", "た")];
    expect(sentenceFields(text, tokens, "食べる")).toEqual({
      sentence: "肉を<b>食べ</b>た",
      withFurigana: "肉[にく]を<b> 食[た]べ</b>た".replace("肉", " 肉").trimStart(),
    });
  });

  it("drops speaker labels and inline readings, and escapes the rest", () => {
    const text = "（なでしこ）焚(た)き火<3";
    const tokens = [token(6, "焚き火", "焚き火", "たきび")];
    expect(sentenceFields(text, tokens, "焚き火").sentence).toBe("<b>焚き火</b>&lt;3");
  });
});

describe("pickEntry", () => {
  const stop = { written: ["止める"], readings: ["とめる"], common: true, meaning: "to stop" };
  const quit = { written: ["止める", "辞める"], readings: ["やめる"], common: true, meaning: "to quit" };

  it("uses the reading to choose between words spelled alike", () => {
    expect(pickEntry([stop, quit], "止める", "やめる")).toMatchObject({ entry: quit, reading: "やめる" });
    expect(pickEntry([stop, quit], "止める", "とめる")).toMatchObject({ entry: stop, reading: "とめる" });
  });

  it("falls back to the entry's own reading, and finds nothing for other spellings", () => {
    expect(pickEntry([stop], "止める", "ちがう")?.reading).toBe("とめる");
    expect(pickEntry([stop], "辞める", "やめる")).toBeNull();
  });

  it("matches words written in kana", () => {
    expect(pickEntry([stop], "とめる", "とめる")?.entry).toBe(stop);
  });
});

describe("compactEntry", () => {
  it("keeps the first few senses and glosses", () => {
    const gloss = (text: string) => ({ text });
    const entry = compactEntry({
      kanji: [{ text: "語", common: false }],
      kana: [{ text: "ご", common: true }],
      sense: [
        { gloss: ["a", "b", "c", "d"].map(gloss) },
        { gloss: [gloss("e")] },
        { gloss: [gloss("f")] },
        { gloss: [gloss("g")] },
      ],
    });
    expect(entry).toEqual({ written: ["語"], readings: ["ご"], common: true, meaning: "a, b, c; e; f" });
  });
});

describe("fileFromTar", () => {
  function entry(name: string, body: string): Buffer {
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    padded.write(body);
    return Buffer.concat([header, padded]);
  }

  it("skips other files and returns the exact contents", () => {
    const tar = Buffer.concat([entry("readme.txt", "x".repeat(600)), entry("data.json", "{}"), Buffer.alloc(1024)]);
    expect(fileFromTar(tar, ".json")?.toString()).toBe("{}");
    expect(fileFromTar(tar, ".png")).toBeNull();
  });
});
