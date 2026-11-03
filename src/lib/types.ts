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

export const COMPREHENSION_LABELS = [
  "Lost",
  "Fragments",
  "The gist",
  "Most of it",
  "Nearly all",
] as const;

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
}
