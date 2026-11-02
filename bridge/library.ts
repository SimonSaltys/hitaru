import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSrt, readMkvJapaneseCues, type Cue } from "./subtitles.ts";

const VIDEO_TYPES: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};
const SIDECAR_SUFFIXES = [".ja.srt", ".jpn.srt", ".srt"];

export interface Episode {
  id: string;
  /** File name without its extension. */
  name: string;
  /** Top-level folder without any parenthetical, used as the title when logging. */
  show: string;
  /** Path of the containing folder, relative to the library root. */
  folder: string;
}

export interface SubtitleTrack {
  source: string | null;
  cues: Cue[];
}

export function libraryRoot(): string {
  return process.env.HITARU_LIBRARY ?? path.join(os.homedir(), "Desktop", "Shows");
}

function episodeFor(root: string, file: string): Episode {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  const top = parts.length > 1 ? parts[0]! : path.parse(file).name;
  return {
    id: Buffer.from(relative, "utf8").toString("base64url"),
    name: path.parse(file).name,
    show: top.replace(/\s*\([^)]*\)\s*$/, "").trim(),
    folder: path.dirname(relative),
  };
}

export function listEpisodes(root = libraryRoot()): Episode[] {
  const episodes: Episode[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (path.extname(entry.name).toLowerCase() in VIDEO_TYPES) episodes.push(episodeFor(root, full));
    }
  };
  visit(root);
  return episodes.sort((a, b) =>
    `${a.folder}/${a.name}`.localeCompare(`${b.folder}/${b.name}`, undefined, { numeric: true }),
  );
}

/** Turns an id back into a path, refusing anything outside the library or not a video. */
export function resolveEpisode(id: string, root = libraryRoot()): string | null {
  const file = path.resolve(root, Buffer.from(id, "base64url").toString("utf8"));
  const relative = path.relative(path.resolve(root), file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!(path.extname(file).toLowerCase() in VIDEO_TYPES)) return null;
  return fs.existsSync(file) ? file : null;
}

export function contentType(file: string): string {
  return VIDEO_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

const cache = new Map<string, SubtitleTrack>();

/** Prefers the file's own Japanese track, whose timing is made for that exact video. */
export function subtitlesFor(file: string): SubtitleTrack {
  const cached = cache.get(file);
  if (cached) return cached;

  let track: SubtitleTrack = { source: null, cues: [] };
  const embedded = path.extname(file).toLowerCase() === ".mkv" ? readMkvJapaneseCues(file) : null;
  if (embedded && embedded.length > 0) {
    track = { source: "Built-in Japanese track", cues: embedded };
  } else {
    const base = file.slice(0, -path.extname(file).length);
    const sidecar = SIDECAR_SUFFIXES.map((suffix) => base + suffix).find((f) => fs.existsSync(f));
    if (sidecar) track = { source: path.basename(sidecar), cues: parseSrt(fs.readFileSync(sidecar, "utf8")) };
  }
  cache.set(file, track);
  return track;
}
