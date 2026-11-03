import { useEffect, useMemo, useState } from "react";
import type { AnkiWord } from "../../bridge/anki";
import { buildKnownWords, type KnownWords } from "../lib/known";

const STORAGE_KEY = "hitaru.anki.words.v1";

export interface AnkiWords {
  known: KnownWords;
  count: number;
  /** "saved" means Anki is closed and these are from the last time it was open. */
  source: "loading" | "live" | "saved" | "none";
  /** Every word with a card, green or not. Null while Anki can't be reached. */
  inAnki: KnownWords | null;
}

function loadSaved(): AnkiWord[] | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as AnkiWord[]) : null;
  } catch {
    return null;
  }
}

/** Refreshes on returning to the tab, so cards reviewed in the meantime turn green. */
export function useAnkiWords(): AnkiWords {
  const [words, setWords] = useState<AnkiWord[]>(() => loadSaved() ?? []);
  const [source, setSource] = useState<AnkiWords["source"]>("loading");
  const [allWords, setAllWords] = useState<AnkiWord[] | null>(null);

  useEffect(() => {
    const refresh = () => {
      fetch("/api/anki/all-words")
        .then((r) => (r.ok ? (r.json() as Promise<AnkiWord[]>) : null))
        .catch(() => null)
        .then(setAllWords);
      fetch("/api/anki/words")
        .then((r) => {
          if (!r.ok) throw new Error(`Status ${r.status}`);
          return r.json() as Promise<AnkiWord[]>;
        })
        .then((next) => {
          setWords(next);
          setSource("live");
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // Only costs the fallback for when Anki is closed.
          }
        })
        .catch(() => setSource(loadSaved() ? "saved" : "none"));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const known = useMemo(() => buildKnownWords(words), [words]);
  const inAnki = useMemo(() => (allWords ? buildKnownWords(allWords) : null), [allWords]);
  return { known, count: words.length, source, inAnki };
}
