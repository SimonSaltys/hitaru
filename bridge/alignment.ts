import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Cue } from "./subtitles.ts";

const ALIGNER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "aligner");

export interface TimedWord {
  /** Character range in the cue's text. */
  from: number;
  to: number;
  start: number;
  end: number;
}

export type AlignmentState =
  | { state: "none" }
  | { state: "queued" }
  | { state: "running"; done: number; total: number }
  | { state: "failed"; message: string }
  /** `cues` has one entry per subtitle; null means that line isn't highlighted. */
  | { state: "ready"; cues: (TimedWord[] | null)[] };

interface StoredCue {
  text: string;
  status: string;
  words: TimedWord[];
}

/** Kept beside the video, so the timings follow it if the folder moves. */
export function alignmentFile(video: string): string {
  return `${video.slice(0, -path.extname(video).length)}.words.json`;
}

/** Reads saved timings, ignoring any line whose subtitle text has since changed. */
export function readAlignment(video: string, cues: Cue[]): (TimedWord[] | null)[] | null {
  let stored: { cues: StoredCue[] };
  try {
    stored = JSON.parse(fs.readFileSync(alignmentFile(video), "utf8")) as { cues: StoredCue[] };
  } catch {
    return null;
  }
  return cues.map((cue, i) => {
    const saved = stored.cues[i];
    return saved?.text === cue.text && saved.status === "aligned" ? saved.words : null;
  });
}

interface Job {
  video: string;
  cues: Cue[];
}

/** Runs the Python aligner one episode at a time, since each one fills the GPU. */
export class AlignmentQueue {
  private queue: Job[] = [];
  private running: { video: string; done: number; total: number } | null = null;
  private failures = new Map<string, string>();

  status(video: string, cues: Cue[]): AlignmentState {
    if (this.running?.video === video) {
      return { state: "running", done: this.running.done, total: this.running.total };
    }
    if (this.queue.some((job) => job.video === video)) return { state: "queued" };
    const failure = this.failures.get(video);
    if (failure) return { state: "failed", message: failure };
    const saved = readAlignment(video, cues);
    return saved ? { state: "ready", cues: saved } : { state: "none" };
  }

  enqueue(video: string, cues: Cue[]): void {
    if (this.running?.video === video || this.queue.some((job) => job.video === video)) return;
    this.failures.delete(video);
    this.queue.push({ video, cues });
    this.next();
  }

  private next(): void {
    const job = this.queue.shift();
    if (this.running || !job) {
      if (job) this.queue.unshift(job);
      return;
    }
    this.running = { video: job.video, done: 0, total: job.cues.length };

    const cueFile = path.join(os.tmpdir(), `hitaru-cues-${process.pid}.json`);
    fs.writeFileSync(cueFile, JSON.stringify(job.cues));
    const child = spawn(
      "uv",
      ["run", "-q", "python", "-W", "ignore", "align.py", "--video", job.video, "--cues", cueFile, "--out", alignmentFile(job.video)],
      { cwd: ALIGNER_DIR, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true },
    );
    const stopChild = () => child.kill();
    process.once("exit", stopChild);

    let buffer = "";
    let lastError = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { type?: string; done?: number; total?: number };
          if (event.type === "progress" && this.running) {
            this.running.done = event.done ?? 0;
            this.running.total = event.total ?? 0;
          }
        } catch {
          // Libraries occasionally print plain text here.
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Progress bars go to stderr too, so only an actual error line is worth keeping.
      const error = chunk.split(/\r?\n/).find((line) => /error/i.test(line));
      if (error) lastError = error.trim();
    });

    let finished = false;
    const finish = (message: string | null) => {
      if (finished) return;
      finished = true;
      process.off("exit", stopChild);
      fs.rm(cueFile, { force: true }, () => {});
      if (message) this.failures.set(job.video, message);
      this.running = null;
      this.next();
    };
    child.on("error", (error) => finish(`Couldn't start the aligner: ${error.message}`));
    child.on("close", (code) => finish(code === 0 ? null : lastError || `The aligner stopped with code ${code}`));
  }
}
