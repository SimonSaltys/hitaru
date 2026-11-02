import type { TimedWord } from "../../bridge/alignment";

// A short hold, so a word doesn't blink off in the tiny gaps between words.
const HOLD_SECONDS = 0.12;

export interface TextPiece {
  text: string;
  /** Index into the cue's words, or null for text that isn't spoken. */
  word: number | null;
}

/** The word being spoken at `time`, or -1 if none is. */
export function activeWord(words: TimedWord[], time: number): number {
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]!;
    if (time >= word.start) return time < word.end + HOLD_SECONDS ? i : -1;
  }
  return -1;
}

/** Splits a cue into spoken words and the labels and spaces between them. */
export function textPieces(text: string, words: TimedWord[]): TextPiece[] {
  const pieces: TextPiece[] = [];
  let position = 0;
  words.forEach((word, i) => {
    if (word.from > position) pieces.push({ text: text.slice(position, word.from), word: null });
    pieces.push({ text: text.slice(word.from, word.to), word: i });
    position = word.to;
  });
  if (position < text.length) pieces.push({ text: text.slice(position), word: null });
  return pieces;
}

export interface FuriganaPiece {
  text: string;
  reading?: string;
}

/**
 * Splits out readings written inline, like 犬山(いぬやま), so they can become real furigana.
 * Yomitan can't match a word with its reading in the middle, but it skips ruby text.
 */
export function furiganaPieces(text: string): FuriganaPiece[] {
  const pieces: FuriganaPiece[] = [];
  let position = 0;
  for (const match of text.matchAll(/(\p{Script=Han}+)\(([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\)/gu)) {
    if (match.index > position) pieces.push({ text: text.slice(position, match.index) });
    pieces.push({ text: match[1]!, reading: match[2]! });
    position = match.index + match[0].length;
  }
  if (position < text.length) pieces.push({ text: text.slice(position) });
  return pieces;
}

/**
 * Lets a cue run across the wider subtitle area, keeping a break only where a new speaker
 * starts. Swaps characters one for one, so word positions stay valid.
 */
export function flowLines(text: string): string {
  return text.replace(/\n(?!（)/g, " ");
}
