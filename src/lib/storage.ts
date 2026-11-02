import { CATEGORIES, type AppData, type Category, type Session, type Settings } from "./types";

const DATA_KEY = "hitaru.data.v1";

export const DEFAULT_SETTINGS: Settings = { weeklyGoalHours: 7, priorHours: 0 };

function emptyData(): AppData {
  return { sessions: [], settings: DEFAULT_SETTINGS, lastBackup: null };
}

export function newId(): string {
  return crypto.randomUUID();
}

function parseSession(raw: unknown): Session | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return null;
  if (typeof s.minutes !== "number" || !Number.isFinite(s.minutes) || s.minutes <= 0) return null;
  const category = CATEGORIES.includes(s.category as Category) ? (s.category as Category) : "Other";
  const rating = s.comprehension;
  const comprehension =
    typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5
      ? rating
      : null;
  return {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    date: s.date,
    minutes: Math.round(s.minutes),
    category,
    title: typeof s.title === "string" ? s.title : "",
    comprehension,
  };
}

function parseSettings(raw: unknown): Settings {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const nonNegative = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    weeklyGoalHours: nonNegative(s.weeklyGoalHours, DEFAULT_SETTINGS.weeklyGoalHours),
    priorHours: nonNegative(s.priorHours, DEFAULT_SETTINGS.priorHours),
  };
}

export function parseData(json: string): AppData {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as AppData).sessions)) {
    throw new Error("Not a Hitaru backup file");
  }
  const data = raw as Record<string, unknown>;
  return {
    sessions: (data.sessions as unknown[])
      .map(parseSession)
      .filter((s): s is Session => s !== null),
    settings: parseSettings(data.settings),
    lastBackup: typeof data.lastBackup === "string" ? data.lastBackup : null,
  };
}

export function loadData(): AppData {
  const stored = localStorage.getItem(DATA_KEY);
  // A corrupt store must not be silently replaced: let the error reach the caller.
  return stored === null ? emptyData() : parseData(stored);
}

export function saveData(data: AppData): void {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

export function subscribeToOtherTabs(onChange: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === DATA_KEY) onChange();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Imported sessions overwrite ones with the same id; everything else is kept. */
export function mergeSessions(current: Session[], incoming: Session[]): Session[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()];
}
