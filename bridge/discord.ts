import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { toKey } from "../src/lib/dates.ts";
import { formatMinutes, minutesByDay, streaks, totalMinutes } from "../src/lib/stats.ts";
import { parseData } from "../src/lib/storage.ts";
import type { Session } from "../src/lib/types.ts";

/** What is being watched right now, from mpv or the Watch page. */
export interface Watching {
  show: string;
  episode: string | null;
  playing: boolean;
  /** Unlogged watch time so far, counted toward today's and the total figures. */
  activeMs: number;
}

export interface Activity {
  type: 3;
  details: string;
  state: string;
  timestamps?: { start: number };
  assets: { large_image: string; large_text: string; small_image: string; small_text: string };
}

// Art asset names under Rich Presence → Art Assets in the Developer Portal.
const LOGO_ASSET = "hitaru";
const PLAYING_ASSET = "playing";
const PAUSED_ASSET = "paused";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

// Discord rejects fields outside 2 to 128 characters.
function field(text: string): string {
  const trimmed = text.length > 128 ? `${text.slice(0, 127)}…` : text;
  return trimmed.padEnd(2, " ");
}

/** The presence for `watching`, with stats from the saved log text. */
export function buildActivity(watching: Watching, logText: string | null, now: Date): Activity {
  const data = logText ? parseData(logText) : null;
  // Counted as if already logged, so the figures move while watching.
  const unlogged: Session = {
    id: "",
    date: toKey(now),
    minutes: watching.activeMs / 60_000,
    category: "Other",
    title: "",
    comprehension: null,
  };
  const sessions = [...(data?.sessions ?? []), ...(unlogged.minutes > 0 ? [unlogged] : [])];
  const today = minutesByDay(sessions).get(toKey(now)) ?? 0;
  const total = totalMinutes(sessions, data?.settings.priorHours ?? 0);
  const streak = streaks(sessions, now).current;

  const stats = [
    streak > 0 && `🔥 ${streak} ${streak === 1 ? "day" : "days"}`,
    `${formatMinutes(today)} today`,
    `${Math.floor(total / 60).toLocaleString("en-US")}h total`,
  ].filter(Boolean);

  const title = watching.episode ? `${watching.show} · ${watching.episode}` : watching.show;
  return {
    type: 3,
    details: field(watching.playing ? title : `Paused: ${title}`),
    state: field(stats.join(" · ")),
    ...(watching.playing && { timestamps: { start: now.getTime() - watching.activeMs } }),
    assets: {
      large_image: LOGO_ASSET,
      large_text: `浸る Hitaru · ${Math.floor(total / 60).toLocaleString("en-US")} hours of Japanese immersion`,
      small_image: watching.playing ? PLAYING_ASSET : PAUSED_ASSET,
      small_text: watching.playing ? "Playing" : "Paused",
    },
  };
}

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Splits complete frames off `buffer`, returning them and whatever is left over. */
export function decodeFrames(buffer: Buffer): { frames: { op: number; payload: unknown }[]; rest: Buffer } {
  const frames: { op: number; payload: unknown }[] = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readUInt32LE(offset);
    const length = buffer.readUInt32LE(offset + 4);
    if (buffer.length - offset - 8 < length) break;
    const text = buffer.toString("utf8", offset + 8, offset + 8 + length);
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // Kept as null; a bad frame shouldn't stop the ones after it.
    }
    frames.push({ op, payload });
    offset += 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function pipePath(index: number): string {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${index}`;
  const dir = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? "/tmp";
  return path.join(dir, `discord-ipc-${index}`);
}

const RECONNECT_MS = 15_000;
const PIPES_TRIED = 10;
// Discord allows 5 updates per 20 seconds.
const MIN_UPDATE_MS = 4_000;

/** "S01E05" or "Episode 5" style names shortened, otherwise the file name without tags. */
export function episodeLabel(name: string): string {
  const season = name.match(/\bS(\d{1,2})\s*E(\d{1,4})\b/i);
  if (season) return `S${Number(season[1])} E${Number(season[2])}`;
  const untagged = name.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const episode = untagged.match(/(?:\bep(?:isode)?\.?\s*|\bE|\s-\s*|第)(\d{1,4})(?:話)?(?:v\d)?\s*$/i);
  if (episode) return `Episode ${Number(episode[1])}`;
  return untagged || name;
}

/**
 * Keeps the desired activity shown in the local Discord app, reconnecting
 * whenever Discord starts or restarts. Does nothing while Discord isn't running.
 */
export class DiscordPresence {
  private socket: net.Socket | null = null;
  private ready = false;
  private activity: Activity | null = null;
  private sent: string | null = null;
  private lastError: string | null = null;
  private lastSentAt = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly clientId: string) {
    this.connect(0);
  }

  set(activity: Activity | null): void {
    this.activity = activity;
    this.flush();
  }

  private flush(): void {
    const json = JSON.stringify(this.activity);
    if (!this.ready || !this.socket || json === this.sent || this.pending) return;
    const wait = this.lastSentAt + MIN_UPDATE_MS - Date.now();
    if (wait > 0) {
      this.pending = setTimeout(() => {
        this.pending = null;
        this.flush();
      }, wait);
      this.pending.unref();
      return;
    }
    this.sent = json;
    this.lastSentAt = Date.now();
    this.socket.write(
      encodeFrame(OP_FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: this.activity },
        nonce: randomUUID(),
      }),
    );
  }

  private connect(index: number): void {
    const socket = net.connect(pipePath(index));
    let buffer: Buffer = Buffer.alloc(0);
    let opened = false;

    socket.on("connect", () => {
      opened = true;
      this.socket = socket;
      socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });

    socket.on("data", (chunk: Buffer) => {
      const { frames, rest } = decodeFrames(Buffer.concat([buffer, chunk]));
      buffer = rest;
      for (const { op, payload } of frames) this.handle(socket, op, payload);
    });

    // Routine: Discord isn't running, or uses a later pipe number.
    socket.on("error", () => {});
    socket.on("close", () => {
      if (!opened) {
        if (index + 1 < PIPES_TRIED) return this.connect(index + 1);
        setTimeout(() => this.connect(0), RECONNECT_MS).unref();
        return;
      }
      if (this.socket === socket) {
        this.socket = null;
        this.ready = false;
        this.sent = null;
      }
      setTimeout(() => this.connect(0), RECONNECT_MS).unref();
    });
  }

  private handle(socket: net.Socket, op: number, payload: unknown): void {
    const message = (payload ?? {}) as { evt?: string; cmd?: string; data?: { message?: string }; message?: string };
    if (op === OP_PING) {
      socket.write(encodeFrame(OP_PONG, payload));
    } else if (op === OP_CLOSE) {
      this.report(`Discord closed the connection: ${message.message ?? "no reason given"}`);
      socket.destroy();
    } else if (message.evt === "READY") {
      this.ready = true;
      this.lastError = null;
      this.flush();
    } else if (message.evt === "ERROR") {
      this.report(`Discord rejected the presence: ${message.data?.message ?? "no reason given"}`);
    }
  }

  /** Logs each distinct problem once, so a bad client ID doesn't flood the terminal. */
  private report(error: string): void {
    if (error === this.lastError) return;
    this.lastError = error;
    console.warn(`[hitaru] ${error}`);
  }
}
