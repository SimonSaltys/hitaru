const PROGRESS_KEY = "hitaru.watch.v1";
const POSITIONS_KEY = "hitaru.positions.v1";
const OFFSETS_KEY = "hitaru.subOffsets.v1";
const LAST_KEY = "hitaru.lastEpisode.v1";

/** Unlogged watching for one show. Cue keys stop rewatched lines from counting twice. */
export interface ShowProgress {
  activeMs: number;
  lines: Record<string, string>;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Watching still works for this page view without persistence.
  }
}

export function loadProgress(show: string): ShowProgress {
  return read<Record<string, ShowProgress>>(PROGRESS_KEY, {})[show] ?? { activeMs: 0, lines: {} };
}

export function saveProgress(show: string, progress: ShowProgress): void {
  write(PROGRESS_KEY, { ...read<Record<string, ShowProgress>>(PROGRESS_KEY, {}), [show]: progress });
}

export function clearProgress(show: string): void {
  const { [show]: _removed, ...rest } = read<Record<string, ShowProgress>>(PROGRESS_KEY, {});
  write(PROGRESS_KEY, rest);
}

export function loadPosition(id: string): number {
  return read<Record<string, number>>(POSITIONS_KEY, {})[id] ?? 0;
}

export function savePosition(id: string, seconds: number): void {
  write(POSITIONS_KEY, { ...read<Record<string, number>>(POSITIONS_KEY, {}), [id]: seconds });
}

export function loadOffset(id: string): number {
  return read<Record<string, number>>(OFFSETS_KEY, {})[id] ?? 0;
}

export function saveOffset(id: string, seconds: number): void {
  write(OFFSETS_KEY, { ...read<Record<string, number>>(OFFSETS_KEY, {}), [id]: seconds });
}

export function loadLastEpisode(): string | null {
  return read<string | null>(LAST_KEY, null);
}

export function saveLastEpisode(id: string): void {
  write(LAST_KEY, id);
}
