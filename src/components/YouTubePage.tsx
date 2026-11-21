import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMinutes } from "../lib/stats";
import { loadPosition, loadProgress, savePosition, saveProgress, type ShowProgress } from "../lib/watchProgress";
import { addRecent, loadRecent, parseVideoId, saveRecent, youtubeKey, type RecentVideo } from "../lib/youtube";

const SAVE_EVERY_MS = 5000;
// A slow tick means the machine slept or the tab was throttled, not an hour of watching.
const MAX_TICK_MS = 2000;
const RESTART_NEAR_END_SECONDS = 30;
const PRESENCE_REPORT_MS = 5000;

// The parts of YouTube's IFrame Player API used here.
interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  isMuted(): boolean;
  getVolume(): number;
  /** Not in the documented API, but the embed has offered it for years. */
  getVideoData?(): { title?: string; author?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const ENDED = 0;

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube's player couldn't be loaded"));
    };
    document.head.append(script);
  });
  return apiPromise;
}

function errorMessage(code: number): string {
  if (code === 101 || code === 150) return "The uploader doesn't allow this video to be played on other sites.";
  if (code === 100) return "This video was removed or made private.";
  if (code === 2) return "That doesn't look like a valid video.";
  return "YouTube couldn't play this video.";
}

function reportPresence(watching: { show: string; episode: string; playing: boolean; activeMs: number } | null): void {
  void fetch("/api/presence", { method: "POST", body: JSON.stringify(watching), keepalive: true }).catch(() => {});
}

export function YouTubePage({ onSendToLog }: {
  onSendToLog: (progressKey: string, title: string, minutes: number) => void;
}) {
  const [recent, setRecent] = useState<RecentVideo[]>(loadRecent);
  const [videoId, setVideoId] = useState<string | null>(() => recent[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState(false);

  function remember(video: RecentVideo) {
    setRecent((list) => {
      const next = addRecent(list, video);
      saveRecent(next);
      return next;
    });
  }

  function open(id: string) {
    setVideoId(id);
    remember({ id, title: "" });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseVideoId(input);
    setInputError(!id);
    if (!id) return;
    setInput("");
    open(id);
  }

  return (
    <div className="watch">
      <form className="panel youtube-open" onSubmit={submit}>
        <div className="youtube-open-row">
          <label className="field">
            YouTube link
            <input
              type="text"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={input}
              aria-invalid={inputError || undefined}
              onChange={(e) => {
                setInput(e.target.value);
                setInputError(false);
              }}
            />
          </label>
          <button type="submit" className="primary">Play</button>
        </div>
        {inputError && <p className="secondary" role="alert">That isn't a YouTube video link.</p>}
      </form>

      {videoId ? (
        <YouTubePlayer
          key={videoId}
          videoId={videoId}
          recent={recent}
          onTitle={(title) => remember({ id: videoId, title })}
          onOpen={open}
          onSendToLog={onSendToLog}
        />
      ) : (
        <section className="panel">
          <p className="secondary">
            Paste a link to watch it here. Time counts only while the video plays with sound, and you
            choose when to send it to your log.
          </p>
        </section>
      )}
    </div>
  );
}

function YouTubePlayer({ videoId, recent, onTitle, onOpen, onSendToLog }: {
  videoId: string;
  recent: RecentVideo[];
  onTitle: (title: string) => void;
  onOpen: (id: string) => void;
  onSendToLog: (progressKey: string, title: string, minutes: number) => void;
}) {
  const key = youtubeKey(videoId);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [title, setTitle] = useState(() => recent.find((v) => v.id === videoId)?.title ?? "");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ShowProgress>(() => loadProgress(key));
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const titleRef = useRef(title);
  titleRef.current = title;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  useEffect(() => {
    let cancelled = false;
    // YouTube swaps this element for its iframe, so React mustn't own it.
    const target = document.createElement("div");
    hostRef.current?.append(target);
    loadApi()
      .then((YT) => {
        if (cancelled) return;
        const resume = loadPosition(key);
        const player = new YT.Player(target, {
          videoId,
          playerVars: { playsinline: 1, rel: 0, start: Math.floor(resume) },
          events: {
            onReady: () => {
              const name = player.getVideoData?.().title ?? "";
              if (name) {
                setTitle(name);
                onTitleRef.current(name);
              }
              // Starting near the end would just finish straight away.
              const duration = player.getDuration();
              if (duration > 0 && resume >= duration - RESTART_NEAR_END_SECONDS) savePosition(key, 0);
            },
            onStateChange: (e) => {
              setPlaying(e.data === PLAYING);
              if (e.data === ENDED) savePosition(key, 0);
            },
            onError: (e) => setError(errorMessage(e.data)),
          },
        });
        playerRef.current = player;
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      const player = playerRef.current;
      if (player) {
        const time = player.getCurrentTime?.() ?? 0;
        if (time > 0 && player.getPlayerState?.() !== ENDED) savePosition(key, time);
        player.destroy();
      }
      playerRef.current = null;
      target.remove();
    };
  }, [videoId, key]);

  // Counts only playback you can hear, like the browser extension: not paused, buffering or muted.
  useEffect(() => {
    let last = Date.now();
    let lastSave = last;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min(now - last, MAX_TICK_MS);
      last = now;
      const player = playerRef.current;
      if (player?.getPlayerState?.() === PLAYING && !player.isMuted() && player.getVolume() > 0) {
        setProgress((p) => ({ ...p, activeMs: p.activeMs + elapsed }));
      }
      if (now - lastSave >= SAVE_EVERY_MS) {
        lastSave = now;
        saveProgress(key, progressRef.current);
        const time = player?.getCurrentTime?.() ?? 0;
        if (time > 0 && player?.getPlayerState?.() !== ENDED) savePosition(key, time);
      }
    }, 1000);
    return () => {
      clearInterval(interval);
      saveProgress(key, progressRef.current);
    };
  }, [key]);

  // Tells the server what's on, for Discord. It forgets this if the reports stop.
  useEffect(() => {
    const current = () => ({
      show: titleRef.current || "YouTube video",
      episode: "YouTube",
      playing,
      activeMs: progressRef.current.activeMs,
    });
    reportPresence(current());
    const interval = setInterval(() => reportPresence(current()), PRESENCE_REPORT_MS);
    return () => clearInterval(interval);
  }, [playing, title]);
  useEffect(() => () => reportPresence(null), []);

  const others = recent.filter((v) => v.id !== videoId);

  return (
    <div className="player youtube-player">
      <div className="player-main">
        <div className="stage youtube-stage" ref={hostRef} />

        {error && (
          <p className="banner" role="alert">
            {error}{" "}
            <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">
              Open it on YouTube
            </a>{" "}
            instead. The extension will time it there.
          </p>
        )}

        <section className="panel">
          <div className="live-header">
            <h2>Not logged yet: {title || "YouTube video"}</h2>
          </div>
          <dl className="live-stats">
            <div><dt>Watch time</dt><dd>{formatMinutes(progress.activeMs / 60_000)}</dd></div>
          </dl>
          <button
            type="button"
            className="primary"
            disabled={progress.activeMs < 1000}
            onClick={() => {
              saveProgress(key, progressRef.current);
              onSendToLog(key, title || "YouTube video", Math.min(1440, Math.max(1, Math.round(progress.activeMs / 60_000))));
              // This page saves its progress as it closes, which would bring the logged time back.
              const logged = { activeMs: 0, lines: {} };
              progressRef.current = logged;
              setProgress(logged);
            }}
          >
            Send to log
          </button>
        </section>
      </div>

      {others.length > 0 && (
        <section className="panel youtube-recent">
          <h2>Recent</h2>
          <ul>
            {others.map((v) => (
              <li key={v.id}>
                <button type="button" className="ghost" title={v.title || v.id} onClick={() => onOpen(v.id)}>
                  <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                  <span>{v.title || v.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
