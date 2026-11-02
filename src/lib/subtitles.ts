const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const SINGLE_KANA = /^[\p{Script=Hiragana}]$/u;

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

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
