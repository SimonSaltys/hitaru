import fs from "node:fs";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { AlignmentQueue } from "./alignment.ts";
import { greenWords } from "./anki.ts";
import { Capture, OBSERVED_PROPERTIES, type CaptureEvent } from "./capture.ts";
import { contentType, listEpisodes, resolveEpisode, subtitlesFor } from "./library.ts";
import { DataStore, defaultDataDir, isLogData } from "./store.ts";
import { loadTokenizer, tokenizeCue, type CueToken } from "./tokens.ts";

const MAX_DATA_BYTES = 20 * 1024 * 1024;

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
  const capture = new Capture((event) => clients.forEach((client) => send(client, event)));
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

  middlewares.use("/api/anki/words", (req, res, next) => {
    if (req.method !== "GET") return next();
    greenWords()
      .then((words) => sendJson(res, words))
      .catch(() => {
        // Anki being closed is routine; the page falls back to the last list it saw.
        res.statusCode = 503;
        res.end();
      });
  });

  middlewares.use("/api/library", (req, res, next) => {
    if (req.method === "POST") {
      const file = resolveEpisode(req.url?.match(/^\/([\w-]+)\/align$/)?.[1] ?? "");
      if (!file) return next();
      if (!isSameOrigin(req)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      alignments.enqueue(file, subtitlesFor(file).cues);
      res.statusCode = 204;
      res.end();
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
      const cached = tokenCache.get(file);
      if (cached) return sendJson(res, cached);
      loadTokenizer()
        .then((tokenizer) => {
          const tokens = subtitlesFor(file).cues.map((cue) => tokenizeCue(tokenizer, cue.text));
          tokenCache.set(file, tokens);
          sendJson(res, tokens);
        })
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
