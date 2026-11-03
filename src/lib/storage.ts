import { CATEGORIES, type AppData, type Category, type Session, type SessionStats, type Settings } from "./types";

const DATA_KEY = "hitaru.data.v1";
const MIGRATED_KEY = "hitaru.data.v1.migrated";

export const DEFAULT_SETTINGS: Settings = { weeklyGoalHours: 7, priorHours: 0 };

function emptyData(): AppData {
  return { sessions: [], settings: DEFAULT_SETTINGS, lastBackup: null };
}

export function newId(): string {
  return crypto.randomUUID();
}

function parseStats(raw: unknown): SessionStats | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (typeof s.episode !== "string" || !count(s.lines) || !count(s.words) || !count(s.uniqueWords)) return null;
  const u = s.understanding as Record<string, unknown> | null | undefined;
  const understanding =
    u && count(u.words) && count(u.knownWords) && count(u.lines) && count(u.knownLines)
      ? { words: u.words as number, knownWords: u.knownWords as number, lines: u.lines as number, knownLines: u.knownLines as number }
      : null;
  return {
    episode: s.episode,
    lines: s.lines as number,
    words: s.words as number,
    uniqueWords: s.uniqueWords as number,
    understanding,
  };
}

export function parseSession(raw: unknown): Session | null {
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
  const stats = parseStats(s.stats);
  return {
    id: typeof s.id === "string" && s.id ? s.id : newId(),
    date: s.date,
    minutes: Math.round(s.minutes),
    category,
    title: typeof s.title === "string" ? s.title : "",
    comprehension,
    ...(stats && { stats }),
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

interface Stored {
  revision: string;
  text: string | null;
  path: string;
}

/** Another tab or address saved first. `data` is what's on disk now. */
export class SaveConflict extends Error {
  constructor(readonly data: AppData) {
    super("The log changed since it was loaded");
  }
}

let revision = "";
let dataPath = "";

export function getDataPath(): string {
  return dataPath;
}

// Saves run one at a time, so each is based on the revision the last one produced.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function readStored(): Promise<Stored> {
  const response = await fetch("/api/data");
  if (!response.ok) throw new Error(`Couldn't read the log (${response.status})`);
  return (await response.json()) as Stored;
}

/** Adopts what's on disk. A damaged file throws here, so it's reported and never overwritten. */
function adopt(stored: Stored): AppData {
  const data = stored.text === null ? emptyData() : parseData(stored.text);
  revision = stored.revision;
  dataPath = stored.path;
  return data;
}

async function put(data: AppData): Promise<void> {
  const response = await fetch(`/api/data?revision=${encodeURIComponent(revision)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2),
  });
  if (response.status === 409) {
    const { current } = (await response.json()) as { current: Stored };
    throw new SaveConflict(adopt(current));
  }
  if (!response.ok) throw new Error(`Couldn't save the log (${response.status})`);
  revision = ((await response.json()) as { revision: string }).revision;
}

/** Applies a change to the latest log on disk, starting again if something else saves first. */
async function change(apply: (latest: AppData, exists: boolean) => AppData): Promise<AppData> {
  for (let attempt = 0; ; attempt++) {
    const stored = await readStored();
    const next = apply(adopt(stored), stored.text !== null);
    try {
      await put(next);
      return next;
    } catch (error) {
      if (!(error instanceof SaveConflict) || attempt >= 4) throw error;
    }
  }
}

/**
 * Logs used to live in localStorage, separately for each address the app was opened on.
 * Each one is merged in once. The old copy stays in the browser, in case it's ever needed.
 */
async function migrateFromBrowser(): Promise<void> {
  const raw = localStorage.getItem(DATA_KEY);
  if (raw === null || localStorage.getItem(MIGRATED_KEY) !== null) return;
  let old: AppData;
  try {
    old = parseData(raw);
  } catch {
    return;
  }
  await change((latest, exists) => ({
    sessions: addNewSessions(latest.sessions, old.sessions),
    settings: exists ? latest.settings : old.settings,
    lastBackup: latest.lastBackup ?? old.lastBackup,
  }));
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
}

export function loadData(): Promise<AppData> {
  return enqueue(async () => {
    await migrateFromBrowser();
    return adopt(await readStored());
  });
}

export function saveData(data: AppData): Promise<void> {
  return enqueue(() => put(data));
}

export function updateData(apply: (latest: AppData) => AppData): Promise<AppData> {
  return enqueue(() => change(apply));
}

/** The log if it has changed on disk, or null if it hasn't or the server can't be reached. */
export function refreshData(): Promise<AppData | null> {
  return enqueue(async () => {
    let stored: Stored;
    try {
      stored = await readStored();
    } catch {
      return null;
    }
    return stored.revision === revision ? null : adopt(stored);
  });
}

/**
 * Adds sessions from the browser extension, which can deliver one twice. A repeat is
 * skipped rather than overwritten, so it can't undo a rating given in the meantime.
 */
export function addNewSessions(current: Session[], incoming: unknown[]): Session[] {
  const ids = new Set(current.map((s) => s.id));
  const added = incoming
    .map(parseSession)
    .filter((s): s is Session => s !== null && !ids.has(s.id));
  return [...current, ...added];
}

/** Imported sessions overwrite ones with the same id; everything else is kept. */
export function mergeSessions(current: Session[], incoming: Session[]): Session[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()];
}
