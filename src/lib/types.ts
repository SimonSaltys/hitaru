export const CATEGORIES = [
  "Anime & TV",
  "YouTube",
  "Podcasts & audio",
  "Reading",
  "Games",
  "Conversation",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Rated 1 to 7. Finer at the low end, where progress is slowest. */
export const COMPREHENSION_LABELS = [
  "Lost",
  "Single words",
  "Fragments",
  "Some sentences",
  "The gist",
  "Most of it",
  "Nearly all",
] as const;

/** Saved with the log, so ratings from the old 1 to 5 scale can be recognised and converted. */
export const RATING_SCALE = COMPREHENSION_LABELS.length;

/** Measured when logging from the Watch page. */
export interface SessionStats {
  episode: string;
  lines: number;
  words: number;
  uniqueWords: number;
  /** How much of the vocabulary heard was known at the time; null if Anki's list wasn't available. */
  understanding: { words: number; knownWords: number; lines: number; knownLines: number } | null;
}

export interface Session {
  id: string;
  date: string;
  minutes: number;
  category: Category;
  title: string;
  /** Self-rated 1-5, or null when not rated. */
  comprehension: number | null;
  stats?: SessionStats;
}

export interface Settings {
  weeklyGoalHours: number;
  /** Immersion done before using this tracker; counts toward the total. */
  priorHours: number;
}

export interface AppData {
  sessions: Session[];
  settings: Settings;
  lastBackup: string | null;
  /** The last day Anki reviews were marked as done, as a date key. */
  ankiDone: string | null;
  ratingScale: typeof RATING_SCALE;
}
