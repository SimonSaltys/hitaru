import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BACKUPS_KEPT = 30;

export interface StoredData {
  /** Identifies this exact content; empty when there's no file yet. */
  revision: string;
  /** Raw, so the page can report a damaged file instead of having it replaced. */
  text: string | null;
  path: string;
}

export type WriteResult = { saved: true; revision: string } | { saved: false; current: StoredData };

export function defaultDataDir(): string {
  return process.env.HITARU_DATA ?? path.join(os.homedir(), "Documents", "Hitaru");
}

function revisionOf(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isLogData(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === "object" && raw !== null && Array.isArray((raw as { sessions?: unknown }).sessions);
  } catch {
    return false;
  }
}

/**
 * The log as one JSON file. The revision comes from the content rather than a counter,
 * so it survives restarts and also catches a second server or a hand edit.
 */
export class DataStore {
  readonly file: string;
  private readonly backups: string;

  constructor(dir: string) {
    this.file = path.join(dir, "hitaru-data.json");
    this.backups = path.join(dir, "backups");
  }

  read(): StoredData {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { revision: "", text: null, path: this.file };
    }
    return { revision: revisionOf(text), text, path: this.file };
  }

  /** Refuses the write if the file has changed since `revision` was read. */
  write(revision: string, text: string, now = new Date()): WriteResult {
    const current = this.read();
    if (current.revision !== revision) return { saved: false, current };
    if (current.text !== null) this.backUp(now);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Written beside the file and swapped in, so a crash can't leave half a log.
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, this.file);
    return { saved: true, revision: revisionOf(text) };
  }

  /** Keeps the log as it stood before each day's first change. */
  private backUp(now: Date): void {
    fs.mkdirSync(this.backups, { recursive: true });
    const today = path.join(this.backups, `hitaru-${localDate(now)}.json`);
    if (fs.existsSync(today)) return;
    fs.copyFileSync(this.file, today);
    // Dated names sort oldest first.
    const old = fs.readdirSync(this.backups).filter((name) => /^hitaru-.*\.json$/.test(name)).sort();
    for (const name of old.slice(0, -BACKUPS_KEPT)) fs.rmSync(path.join(this.backups, name));
  }
}
