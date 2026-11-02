import type { AnkiWord } from "../../bridge/anki";
import type { CueToken } from "../../bridge/tokens";

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

export interface KnownWords {
  written: Set<string>;
  readings: Set<string>;
}

export function buildKnownWords(words: AnkiWord[]): KnownWords {
  const written = new Set<string>();
  const readings = new Set<string>();
  for (const { word, reading } of words) {
    written.add(word);
    // 勉強する on a card should still match 勉強, which is analysed apart from its する.
    if (word.length > 2 && word.endsWith("する")) written.add(word.slice(0, -2));
    for (const one of reading.split(/[・、,/]/)) {
      if (one.trim()) readings.add(one.trim());
    }
  }
  return { written, readings };
}

/**
 * Matches by spelling, or by sound when the subtitle writes a word in kana. Sound only applies
 * to vocabulary of two or more kana, so a card for 歯 (は) doesn't claim the particle は.
 */
export function isKnown(token: CueToken, known: KnownWords): boolean {
  if (known.written.has(token.lemma) || known.written.has(token.surface)) return true;
  if (!token.counts || !KANA_ONLY.test(token.surface) || token.reading.length < 2) return false;
  return known.readings.has(token.reading);
}

export interface Understanding {
  /** Vocabulary the subtitles use, repeats included. */
  words: number;
  knownWords: number;
  /** Lines containing any vocabulary. */
  lines: number;
  /** Lines where all of that vocabulary is known. */
  knownLines: number;
}

export function understanding(cues: CueToken[][], known: KnownWords): Understanding {
  const result: Understanding = { words: 0, knownWords: 0, lines: 0, knownLines: 0 };
  for (const tokens of cues) {
    const vocabulary = tokens.filter((t) => t.counts);
    if (vocabulary.length === 0) continue;
    const knownCount = vocabulary.filter((t) => isKnown(t, known)).length;
    result.words += vocabulary.length;
    result.knownWords += knownCount;
    result.lines += 1;
    if (knownCount === vocabulary.length) result.knownLines += 1;
  }
  return result;
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

export interface MarkedPiece {
  text: string;
  /** Index into the cue's timed words, or null for text that isn't spoken. */
  word: number | null;
  known: boolean;
}

/** Splits pieces wherever a known word starts or ends, so both highlights can apply at once. */
export function markKnown(
  pieces: { text: string; word: number | null }[],
  ranges: { from: number; to: number }[],
): MarkedPiece[] {
  const marked: MarkedPiece[] = [];
  let position = 0;
  for (const piece of pieces) {
    const end = position + piece.text.length;
    const cuts = new Set([position, end]);
    for (const { from, to } of ranges) {
      if (from > position && from < end) cuts.add(from);
      if (to > position && to < end) cuts.add(to);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const start = sorted[i]!;
      const stop = sorted[i + 1]!;
      if (stop === start) continue;
      marked.push({
        text: piece.text.slice(start - position, stop - position),
        word: piece.word,
        known: ranges.some((r) => r.from <= start && stop <= r.to),
      });
    }
    position = end;
  }
  return marked;
}
