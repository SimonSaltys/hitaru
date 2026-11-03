import type { CueToken } from "../../bridge/tokens";
import { isKnown, type KnownWords } from "./known";

export interface WordToLearn {
  lemma: string;
  /** How many times the episode uses it. */
  count: number;
  /** The line to learn it from. */
  cue: number;
}

/**
 * Words with no card yet, most used first. Each comes with the line that has the fewest other
 * words you don't know, since a sentence full of unknowns makes a poor example.
 */
export function wordsToLearn(
  cues: CueToken[][],
  known: KnownWords,
  inAnki: KnownWords,
): { words: WordToLearn[]; withCards: number } {
  const found = new Map<string, WordToLearn & { others: number }>();
  const withCards = new Set<string>();
  cues.forEach((tokens, cue) => {
    const vocabulary = tokens.filter((t) => t.counts);
    const unknown = new Set(vocabulary.filter((t) => !isKnown(t, known)).map((t) => t.lemma));
    for (const token of vocabulary) {
      if (isKnown(token, known)) continue;
      if (isKnown(token, inAnki)) {
        withCards.add(token.lemma);
        continue;
      }
      const others = unknown.size - 1;
      const entry = found.get(token.lemma);
      if (!entry) found.set(token.lemma, { lemma: token.lemma, count: 1, cue, others });
      else {
        entry.count += 1;
        if (others < entry.others) Object.assign(entry, { cue, others });
      }
    }
  });
  const words = [...found.values()]
    .sort((a, b) => b.count - a.count || a.cue - b.cue)
    .map(({ lemma, count, cue }) => ({ lemma, count, cue }));
  return { words, withCards: withCards.size };
}
