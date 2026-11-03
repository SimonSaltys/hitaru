import { createRequire } from "node:module";
import path from "node:path";
import kuromoji from "kuromoji";

export interface CueToken {
  /** Character range in the cue's text. */
  from: number;
  to: number;
  surface: string;
  /** Dictionary form, so 食べた can match a card for 食べる. */
  lemma: string;
  /** In hiragana, for matching words written without their kanji. */
  reading: string;
  /** Whether it's vocabulary worth scoring, rather than grammar, a name or a sound. */
  counts: boolean;
}

/** The parts of kuromoji's tokens used here, so tests can state their expectations plainly. */
type Tokenizer = kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

const HIDDEN = /（[^（）]*(?:\([^()]*\)[^（）]*)*）|\([^()]*\)|～?♪～?/g;
const INLINE_READING = /^\([\p{Script=Hiragana}\p{Script=Katakana}ー]+\)$/u;
const ENDS_IN_KANJI = /\p{Script=Han}$/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

// Interjections are mostly sounds in subtitles: うん, ああ, あっ.
const GRAMMAR = new Set(["助詞", "助動詞", "記号", "フィラー", "感動詞", "接頭詞"]);
const NOT_VOCABULARY = new Set(["非自立", "接尾", "固有名詞", "数"]);
// Usually a stutter or a piece of a sound effect that the analyzer split off.
const LONE_KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u;

export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Removes what isn't spoken, recording where each remaining character came from. Inline
 * readings vanish entirely so 焚(た)き火 reads as one word; everything else leaves a space,
 * so a speaker label can't join the words around it.
 */
export function readableText(text: string): { text: string; offsets: number[] } {
  let readable = "";
  const offsets: number[] = [];
  const keep = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      readable += text[i];
      offsets.push(i);
    }
  };
  let position = 0;
  for (const match of text.matchAll(HIDDEN)) {
    keep(position, match.index);
    position = match.index + match[0].length;
    const isReading = INLINE_READING.test(match[0]) && ENDS_IN_KANJI.test(text.slice(0, match.index));
    if (!isReading) {
      readable += " ";
      offsets.push(match.index);
    }
  }
  keep(position, text.length);
  return { text: readable, offsets };
}

/** A word's range keeps a reading right after it, or the furigana would split from its kanji. */
function endWithReading(text: string, end: number): number {
  const reading = text.slice(end).match(/^\([\p{Script=Hiragana}\p{Script=Katakana}ー]+\)/u);
  return reading && ENDS_IN_KANJI.test(text.slice(0, end)) ? end + reading[0].length : end;
}

export function tokenizeCue(tokenizer: Tokenizer, text: string): CueToken[] {
  const readable = readableText(text);
  const tokens: CueToken[] = [];
  for (const token of tokenizer.tokenize(readable.text)) {
    if (!JAPANESE.test(token.surface_form)) continue;
    const start = token.word_position - 1;
    const end = start + token.surface_form.length;
    const from = readable.offsets[start]!;
    const to = endWithReading(text, readable.offsets[end - 1]! + 1);
    // A reading written across the whole word beats the analyzer's guess: 薪(まき), not たきぎ.
    const range = text.slice(from, to);
    const written = range.startsWith(token.surface_form) ? range.slice(token.surface_form.length + 1, -1) : "";
    tokens.push({
      from,
      to,
      surface: token.surface_form,
      lemma: token.basic_form === "*" ? token.surface_form : token.basic_form,
      reading: toHiragana(written || (token.reading ?? token.surface_form)),
      counts:
        token.word_type === "KNOWN" &&
        // し is a real verb stem of する, so only a kana that's its own dictionary form is suspect.
        !(LONE_KANA.test(token.surface_form) && token.basic_form === token.surface_form) &&
        !GRAMMAR.has(token.pos) &&
        !NOT_VOCABULARY.has(token.pos_detail_1),
    });
  }
  return tokens;
}

let tokenizer: Promise<Tokenizer> | null = null;

/** Loads the dictionary on first use, which takes about a second. */
export function loadTokenizer(): Promise<Tokenizer> {
  tokenizer ??= new Promise((resolve, reject) => {
    const packageFile = createRequire(import.meta.url).resolve("kuromoji/package.json");
    kuromoji
      .builder({ dicPath: path.join(path.dirname(packageFile), "dict") })
      .build((error, built) => (error ? reject(error) : resolve(built)));
  });
  return tokenizer;
}
