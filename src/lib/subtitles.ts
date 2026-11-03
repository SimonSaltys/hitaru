const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const SINGLE_KANA = /^[\p{Script=Hiragana}]$/u;

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

// A seek can land a hair before the time it asked for, which mustn't count as the previous line.
const SEEK_TOLERANCE_SECONDS = 0.05;

/** Index of the latest line to have started, so it also works just after a line ends. -1 before the first. */
export function latestLine(cues: { start: number }[], time: number): number {
  const next = cues.findIndex((cue) => cue.start > time + SEEK_TOLERANCE_SECONDS);
  return next === -1 ? cues.length - 1 : next - 1;
}

/**
 * The line to pause at in study mode, if any. Stops just before the end so it's still on
 * screen, and `stopped` is the line already paused at, so pressing play can carry on.
 */
export function lineToStopAt(cues: { start: number; end: number }[], time: number, stopped: number | null): number | null {
  const line = cues.findIndex((cue) => time >= cue.start && time < cue.end);
  if (line === -1 || line === stopped) return null;
  return time >= cues[line]!.end - SEEK_TOLERANCE_SECONDS ? line : null;
}

/** Index of the line one step back (-1) or forward (1), or null if there isn't one to go to. */
export function stepLine(cues: { start: number }[], time: number, step: -1 | 1): number | null {
  const latest = latestLine(cues, time);
  if (step === 1) return latest + 1 < cues.length ? latest + 1 : null;
  // On the first line, going back restarts it.
  return latest < 0 ? null : Math.max(latest - 1, 0);
}

/**
 * Splits text into Japanese words. Intl.Segmenter doesn't reduce words to their
 * dictionary form, so 食べる and 食べた count separately; treat counts as estimates.
 */
export function japaneseWords(text: string): string[] {
  return [...segmenter.segment(text)]
    .filter((s) => s.isWordLike && JAPANESE.test(s.segment))
    .map((s) => s.segment);
}

/** Removes parenthesised SDH text: speaker labels, sound cues, and furigana readings. */
export function stripSdh(text: string): string {
  return text.replace(/（[^）]*）|\([^)]*\)/g, " ");
}

export interface SubtitleStats {
  words: number;
  uniqueWords: number;
  wordsPerMinute: number;
  /** Most repeated words, leaving out single-hiragana particles like は and が. */
  topWords: { word: string; count: number }[];
}

export function subtitleStats(lines: string[], activeMs: number, topCount = 12): SubtitleStats {
  const counts = new Map<string, number>();
  let words = 0;
  for (const line of lines) {
    for (const word of japaneseWords(stripSdh(line))) {
      words += 1;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return {
    words,
    uniqueWords: counts.size,
    wordsPerMinute: activeMs >= 60_000 ? Math.round(words / (activeMs / 60_000)) : 0,
    topWords: [...counts]
      .filter(([word]) => !SINGLE_KANA.test(word))
      .sort((a, b) => b[1] - a[1])
      .slice(0, topCount)
      .map(([word, count]) => ({ word, count })),
  };
}

/** Makes a usable session title from what mpv reports, which is often a file name. */
export function cleanTitle(title: string | null): string {
  return (title ?? "").replace(/\.(mkv|mp4|webm|avi|mov|m4v|ts)$/i, "").trim();
}
