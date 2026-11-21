import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { AlignmentQueue } from "./alignment.ts";
import { cleanTitle } from "../src/lib/subtitles.ts";
import { allWords, greenWords } from "./anki.ts";
import { Capture, OBSERVED_PROPERTIES, type CaptureEvent } from "./capture.ts";
import { buildActivity, DiscordPresence, episodeLabel, type Watching } from "./discord.ts";
import { contentType, listEpisodes, resolveEpisode, subtitlesFor } from "./library.ts";
import { CardError, createCard } from "./mining.ts";
import { DataStore, defaultDataDir, isLogData } from "./store.ts";
import { loadTokenizer, toHiragana, tokenizeCue, type CueToken } from "./tokens.ts";

const MAX_DATA_BYTES = 20 * 1024 * 1024;
const MAX_CARD_REQUEST_BYTES = 10 * 1024;
const MAX_PRESENCE_BYTES = 2 * 1024;
// The Watch page reports every few seconds; silence means the tab closed.
const PAGE_WATCHING_EXPIRES_MS = 20_000;
// Refreshes the elapsed stats and drops a closed tab even when nothing else changes.
const PRESENCE_REFRESH_MS = 15_000;

export const MPV_PIPE = process.platform === "win32" ? "\\\\.\\pipe\\hitaru-mpv" : "/tmp/hitaru-mpv";
// Short, so the opening subtitles aren't missed while mpv starts up.
const RECONNECT_MS = 500;

function connectToMpv(capture: Capture): void {
  const socket = net.connect(MPV_PIPE);
  let buffer = "";
  // Decodes across chunks, since one can end partway through a Japanese character.
  socket.setEncoding("utf8");

  socket.on("connect", () => {
    OBSERVED_PROPERTIES.forEach((name, i) => {
      socket.write(`${JSON.stringify({ command: ["observe_property", i + 1, name] })}\n`);
    });
    capture.setConnected(true);
  });

  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const messages = buffer.split("\n");
    buffer = messages.pop() ?? "";
    messages.forEach((message) => capture.handleMessage(message));
  });

  // Errors are routine here: the pipe doesn't exist until mpv is running.
  socket.on("error", () => {});
  socket.on("close", () => {
    capture.setConnected(false);
    setTimeout(() => connectToMpv(capture), RECONNECT_MS).unref();
  });
}

/** Rejects state changes sent by other websites to this localhost server. */
function isSameOrigin(req: IncomingMessage): boolean {
  try {
    return new URL(req.headers.origin ?? "").host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Rejects requests addressed to any other hostname, which stops a malicious site
 * from reading the library by pointing its own domain at 127.0.0.1. Plugin routes
 * run ahead of Vite's own host check, so they need this themselves.
 */
function isLocalHost(req: IncomingMessage): boolean {
  try {
    const { hostname } = new URL(`http://${req.headers.host ?? ""}`);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Resolves to null if the body is over the limit. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function streamVideo(req: IncomingMessage, res: ServerResponse, file: string): void {
  const { size } = fs.statSync(file);
  res.setHeader("Content-Type", contentType(file));
  res.setHeader("Accept-Ranges", "bytes");

  let start = 0;
  let end = size - 1;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (req.headers.range && !range) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }
  if (range) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else if (range[2]) {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("Content-Length", end - start + 1);

  const stream = fs.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  // The browser cancels requests constantly while seeking.
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function attach(middlewares: Connect.Server): void {
  const clients = new Set<ServerResponse>();
  const send = (client: ServerResponse, event: CaptureEvent) => {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const capture = new Capture((event) => {
    clients.forEach((client) => send(client, event));
    if (event.type === "snapshot") updatePresence();
  });
  connectToMpv(capture);

  middlewares.use("/api", (req, res, next) => {
    if (!isLocalHost(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    next();
  });

  const alignments = new AlignmentQueue();
  const tokenCache = new Map<string, CueToken[][]>();
  const store = new DataStore(defaultDataDir());

  const discordClientId = process.env.HITARU_DISCORD_CLIENT_ID?.trim();
  const discord = discordClientId ? new DiscordPresence(discordClientId) : null;
  let pageWatching: { watching: Watching; at: number } | null = null;

  /** mpv and the Watch page, whichever is playing, preferring mpv. */
  function currentWatching(): Watching | null {
    const mpv = capture.snapshot();
    const fromMpv: Watching | null =
      mpv.connected && mpv.title
        ? { show: cleanTitle(mpv.title), episode: null, playing: mpv.playing, activeMs: mpv.activeMs }
        : null;
    const fromPage = pageWatching && Date.now() - pageWatching.at < PAGE_WATCHING_EXPIRES_MS ? pageWatching.watching : null;
    return [fromMpv, fromPage].find((w) => w?.playing) ?? fromMpv ?? fromPage;
  }

  function updatePresence(): void {
    if (!discord) return;
    const watching = currentWatching();
    let log: string | null = null;
    try {
      log = store.read().text;
    } catch {
      // Shown without the logged figures rather than not at all.
    }
    try {
      discord.set(watching ? buildActivity(watching, log, new Date()) : null);
    } catch {
      discord.set(watching ? buildActivity(watching, null, new Date()) : null);
    }
  }
  if (discord) setInterval(updatePresence, PRESENCE_REFRESH_MS).unref();

  middlewares.use("/api/presence", (req, res, next) => {
    if (req.method !== "POST") return next();
    if (!isSameOrigin(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    readBody(req, MAX_PRESENCE_BYTES)
      .then((text) => {
        const body = JSON.parse(text ?? "null") as Partial<{ show: unknown; episode: unknown; playing: unknown; activeMs: unknown }> | null;
        if (
          body &&
          typeof body.show === "string" &&
          body.show &&
          typeof body.episode === "string" &&
          typeof body.playing === "boolean" &&
          typeof body.activeMs === "number" &&
          Number.isFinite(body.activeMs) &&
          body.activeMs >= 0
        ) {
          pageWatching = {
            watching: { show: body.show, episode: episodeLabel(body.episode), playing: body.playing, activeMs: body.activeMs },
            at: Date.now(),
          };
        } else {
          pageWatching = null;
        }
        updatePresence();
        res.statusCode = 204;
        res.end();
      })
      .catch(() => {
        res.statusCode = 400;
        res.end();
      });
  });

  middlewares.use("/api/data", (req, res, next) => {
    if (req.method === "GET") {
      try {
        sendJson(res, store.read());
      } catch {
        res.statusCode = 500;
        res.end();
      }
      return;
    }
    if (req.method !== "PUT") return next();
    if (!isSameOrigin(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const revision = new URL(req.url ?? "/", "http://localhost").searchParams.get("revision") ?? "";
    readBody(req, MAX_DATA_BYTES)
      .then((text) => {
        if (text === null || !isLogData(text)) {
          res.statusCode = text === null ? 413 : 400;
          res.end();
          return;
        }
        const result = store.write(revision, text);
        if (!result.saved) res.statusCode = 409;
        sendJson(res, result);
      })
      .catch(() => {
        res.statusCode = 500;
        res.end();
      });
  });

  const tokensFor = async (file: string): Promise<CueToken[][]> => {
    const cached = tokenCache.get(file);
    if (cached) return cached;
    const tokenizer = await loadTokenizer();
    const tokens = subtitlesFor(file).cues.map((cue) => tokenizeCue(tokenizer, cue.text));
    tokenCache.set(file, tokens);
    return tokens;
  };

  const sendAnkiWords = (load: () => Promise<unknown>, res: ServerResponse) => {
    load()
      .then((words) => sendJson(res, words))
      .catch(() => {
        // Anki being closed is routine; the page falls back to the last list it saw.
        res.statusCode = 503;
        res.end();
      });
  };

  middlewares.use("/api/anki/words", (req, res, next) => {
    if (req.method !== "GET") return next();
    sendAnkiWords(greenWords, res);
  });

  middlewares.use("/api/anki/all-words", (req, res, next) => {
    if (req.method !== "GET") return next();
    sendAnkiWords(allWords, res);
  });

  const makeCard = async (file: string, req: IncomingMessage): Promise<unknown> => {
    const body = await readBody(req, MAX_CARD_REQUEST_BYTES);
    const { cue: index, lemma, offset } = JSON.parse(body ?? "null") as { cue?: unknown; lemma?: unknown; offset?: unknown };
    const cue = typeof index === "number" ? subtitlesFor(file).cues[index] : undefined;
    const tokens = typeof index === "number" ? (await tokensFor(file))[index] : undefined;
    if (!cue || !tokens || typeof lemma !== "string" || typeof offset !== "number" || !Number.isFinite(offset)) {
      throw new CardError("That card request wasn't valid");
    }
    if (!tokens.some((token) => token.lemma === lemma)) throw new CardError(`${lemma} isn't in that line`);
    // In dictionary form the line's own reading applies. Otherwise the analyzer has to read the lemma.
    const tokenizer = await loadTokenizer();
    const reading =
      tokens.find((token) => token.lemma === lemma && token.surface === lemma)?.reading ??
      toHiragana(tokenizer.tokenize(lemma).map((t) => t.reading ?? t.surface_form).join(""));
    const seconds = Math.floor(cue.start);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const label = `${path.parse(file).name} ${time}`;
    return createCard({ video: file, label, cue, tokens, lemma, reading, offset });
  };

  middlewares.use("/api/library", (req, res, next) => {
    if (req.method === "POST") {
      const match = req.url?.match(/^\/([\w-]+)\/(align|card)$/);
      const file = resolveEpisode(match?.[1] ?? "");
      if (!match || !file) return next();
      if (!isSameOrigin(req)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      if (match[2] === "card") {
        makeCard(file, req)
          .then((card) => sendJson(res, card))
          .catch((error: unknown) => {
            res.statusCode = error instanceof CardError ? 422 : 500;
            sendJson(res, { error: error instanceof Error ? error.message : "Couldn't make the card" });
          });
        return;
      }
      readBody(req, MAX_CARD_REQUEST_BYTES)
        .then((body) => {
          const { offset } = (JSON.parse(body || "null") ?? {}) as { offset?: unknown };
          const shift = typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
          alignments.enqueue(file, subtitlesFor(file).cues, shift);
          res.statusCode = 204;
          res.end();
        })
        .catch(() => {
          res.statusCode = 400;
          res.end();
        });
      return;
    }
    if (req.method !== "GET") return next();
    if (req.url === "/" || req.url === "") return sendJson(res, listEpisodes());

    const match = req.url?.match(/^\/([\w-]+)\/(video|subtitles|words|tokens)$/);
    const file = match ? resolveEpisode(match[1]!) : null;
    if (!match || !file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (match[2] === "video") return streamVideo(req, res, file);
    if (match[2] === "words") return sendJson(res, alignments.status(file, subtitlesFor(file).cues));
    if (match[2] === "tokens") {
      tokensFor(file)
        .then((tokens) => sendJson(res, tokens))
        .catch(() => sendJson(res, []));
      return;
    }
    try {
      sendJson(res, subtitlesFor(file));
    } catch {
      sendJson(res, { source: null, cues: [] });
    }
  });

  middlewares.use("/api/mpv", (req, res, next) => {
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      send(res, { type: "snapshot", snapshot: capture.snapshot() });
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method !== "POST") return next();
    if (!isSameOrigin(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }

    const deleteMatch = req.url?.match(/^\/lines\/(\d+)\/delete$/);
    if (req.url === "/reset") capture.reset();
    else if (deleteMatch) capture.removeLine(Number(deleteMatch[1]));
    else return next();
    res.statusCode = 204;
    res.end();
  });
}

/** Serves the video library and mpv's capture under `vite` and `vite preview`. */
export function mpvBridge(): Plugin {
  return {
    name: "hitaru-bridge",
    configureServer: (server) => attach(server.middlewares),
    configurePreviewServer: (server) => attach(server.middlewares),
  };
}
