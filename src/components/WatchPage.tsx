import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignmentState, TimedWord } from "../../bridge/alignment";
import type { Episode, SubtitleTrack } from "../../bridge/library";
import type { Cue } from "../../bridge/subtitles";
import type { CueToken } from "../../bridge/tokens";
import { useAnkiWords } from "../hooks/useAnkiWords";
import { heardTokens, isKnown, markKnown, percent, understanding, type KnownWords } from "../lib/known";
import { wordsToLearn } from "../lib/mining";
import { formatMinutes } from "../lib/stats";
import { latestLine, lineToStopAt, stepLine, subtitleStats } from "../lib/subtitles";
import type { SessionStats } from "../lib/types";
import { activeWord, flowLines, furiganaPieces, textPieces } from "../lib/words";
import {
  loadLastEpisode,
  loadOffset,
  loadPlayerPrefs,
  loadPosition,
  loadProgress,
  saveLastEpisode,
  saveOffset,
  savePlayerPrefs,
  savePosition,
  saveProgress,
  type ShowProgress,
} from "../lib/watchProgress";

const OFFSET_STEP = 0.25;
const SAVE_EVERY_MS = 5000;
// A slow tick means the machine slept or the tab was throttled, not an hour of watching.
const MAX_TICK_MS = 2000;
const RESTART_NEAR_END_SECONDS = 30;
// How long the list stops following after you scroll it yourself.
const FOLLOW_PAUSE_MS = 5000;
// Roughly how long the browser keeps its controls up after the mouse stops.
const CONTROLS_VISIBLE_MS = 3000;
const ALIGNMENT_POLL_MS = 1000;
const WORDS_SHOWN = 15;

function clock(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

function findCue(cues: Cue[], time: number): number {
  return cues.findIndex((cue) => time >= cue.start && time < cue.end);
}

function Furigana({ text }: { text: string }) {
  return furiganaPieces(text).map((piece, i) =>
    piece.reading ? <ruby key={i}>{piece.text}<rt>{piece.reading}</rt></ruby> : piece.text,
  );
}

function knownRanges(tokens: CueToken[] | undefined, known: KnownWords): CueToken[] {
  return tokens?.filter((token) => isKnown(token, known)) ?? [];
}

/** A subtitle line with the words you know picked out. */
function CueText({ text, tokens, known }: { text: string; tokens: CueToken[] | undefined; known: KnownWords }) {
  return markKnown([{ text, word: null }], knownRanges(tokens, known)).map((piece, i) => (
    <span key={i} className={piece.known ? "known" : undefined}><Furigana text={piece.text} /></span>
  ));
}

/** The current subtitle, following the audio word by word when timings exist for it. */
function Overlay({ text, words, tokens, known, offset, video, onMouseMove }: {
  text: string;
  words: TimedWord[] | null;
  tokens: CueToken[] | undefined;
  known: KnownWords;
  offset: number;
  video: React.RefObject<HTMLVideoElement | null>;
  onMouseMove: (e: React.MouseEvent) => void;
}) {
  const [active, setActive] = useState(-1);

  // Every frame, because the video's own time updates are too far apart for short words.
  useEffect(() => {
    if (!words) return;
    let frame = requestAnimationFrame(function tick() {
      if (video.current) setActive(activeWord(words, video.current.currentTime - offset));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [words, offset, video]);

  const shown = flowLines(text);
  return (
    <p className="overlay" lang="ja" onMouseMove={onMouseMove}>
      {markKnown(textPieces(shown, words ?? []), knownRanges(tokens, known)).map((piece, i) => {
        const spoken = piece.word !== null && piece.word === active;
        return (
          <span key={i} className={spoken ? "spoken" : piece.known ? "known" : undefined}>
            <Furigana text={piece.text} />
          </span>
        );
      })}
    </p>
  );
}

/** Unknown words from this episode, each one click from an Anki card. */
function WordsToLearn({ episodeId, cues, tokens, known, inAnki, offset, onPlay }: {
  episodeId: string;
  cues: Cue[];
  tokens: CueToken[][];
  known: KnownWords;
  inAnki: KnownWords | null;
  offset: number;
  onPlay: (cue: number) => void;
}) {
  const [shown, setShown] = useState(WORDS_SHOWN);
  const [cards, setCards] = useState<Record<string, "adding" | "added" | { error: string }>>({});

  const { words, withCards } = useMemo(
    () => (inAnki ? wordsToLearn(tokens, known, inAnki) : { words: [], withCards: 0 }),
    [tokens, known, inAnki],
  );

  async function addCard(lemma: string, cue: number) {
    setCards((c) => ({ ...c, [lemma]: "adding" }));
    try {
      const response = await fetch(`/api/library/${episodeId}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cue, lemma, offset }),
      });
      const body = (await response.json()) as { error?: string };
      setCards((c) => ({ ...c, [lemma]: response.ok ? "added" : { error: body.error ?? "Couldn't make the card" } }));
    } catch {
      setCards((c) => ({ ...c, [lemma]: { error: "Couldn't reach the server" } }));
    }
  }

  if (tokens.length === 0) return null;
  const added = Object.values(cards).filter((state) => state === "added").length;

  return (
    <section className="panel">
      <div className="live-header">
        <h2>Words to learn next</h2>
        {added > 0 && <span className="status">{added} added to Hitaru Mining</span>}
      </div>
      {!inAnki ? (
        <p className="secondary score-note">Open Anki to see which words to learn and add cards.</p>
      ) : (
        <>
          <p className="secondary score-note">
            Most used first, with the easiest line for each. {withCards.toLocaleString()} more already
            have cards you haven't finished learning. The first card also downloads the dictionary.
          </p>
          <ul className="mine-list">
            {words.slice(0, shown).map(({ lemma, count, cue }) => {
              const state = cards[lemma];
              return (
                <li key={lemma}>
                  <span className="mine-word" lang="ja">{lemma} <span className="secondary">{count}×</span></span>
                  <button
                    type="button"
                    className="ghost mine-line"
                    lang="ja"
                    title="Play this line"
                    onClick={() => onPlay(cue)}
                  >
                    <CueText text={cues[cue]?.text ?? ""} tokens={tokens[cue]} known={known} />
                  </button>
                  {state === "added" ? (
                    <span className="secondary">Added</span>
                  ) : (
                    <button type="button" disabled={state === "adding"} onClick={() => void addCard(lemma, cue)}>
                      {state === "adding" ? "Adding…" : "Add card"}
                    </button>
                  )}
                  {typeof state === "object" && <p className="mine-error" role="alert">{state.error}</p>}
                </li>
              );
            })}
          </ul>
          {words.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + WORDS_SHOWN)}>
              Show more ({words.length - shown} left)
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function WatchPage({ onSendToLog }: {
  onSendToLog: (show: string, minutes: number, stats: SessionStats) => void;
}) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json() as Promise<Episode[]>)
      .then((list) => {
        setEpisodes(list);
        const last = loadLastEpisode();
        setSelectedId(list.find((e) => e.id === last)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => setEpisodes([]));
  }, []);

  const folders = useMemo(() => {
    const groups = new Map<string, Episode[]>();
    for (const e of episodes ?? []) groups.set(e.folder, [...(groups.get(e.folder) ?? []), e]);
    return [...groups];
  }, [episodes]);

  const episode = episodes?.find((e) => e.id === selectedId) ?? null;

  if (episodes === null) return <p className="secondary">Loading your library…</p>;
  if (episodes.length === 0) {
    return (
      <section className="panel">
        <h2>No videos found</h2>
        <p className="secondary">
          Put shows in <code>Desktop\Shows</code>, or set the <code>HITARU_LIBRARY</code> environment
          variable to another folder, and restart the app. MKV, MP4 and WebM files are supported.
        </p>
      </section>
    );
  }

  return (
    <div className="watch">
      <label className="field">
        Episode
        <select
          value={selectedId ?? ""}
          onChange={(e) => {
            setSelectedId(e.target.value);
            saveLastEpisode(e.target.value);
          }}
        >
          {folders.map(([folder, list]) => (
            <optgroup key={folder} label={folder}>
              {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {episode && (
        <Player
          key={episode.id}
          episode={episode}
          onEnded={() => {
            const list = episodes;
            const next = list[list.findIndex((e) => e.id === episode.id) + 1];
            if (next && next.folder === episode.folder) {
              setSelectedId(next.id);
              saveLastEpisode(next.id);
            }
          }}
          onSendToLog={onSendToLog}
        />
      )}
    </div>
  );
}

function Player({ episode, onEnded, onSendToLog }: {
  episode: Episode;
  onEnded: () => void;
  onSendToLog: (show: string, minutes: number, stats: SessionStats) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const lastManualScroll = useRef(0);

  const [track, setTrack] = useState<SubtitleTrack | null>(null);
  const [cueIndex, setCueIndex] = useState(-1);
  const [followIndex, setFollowIndex] = useState(-1);
  const [offset, setOffset] = useState(() => loadOffset(episode.id));
  const [progress, setProgress] = useState<ShowProgress>(() => loadProgress(episode.show));
  const [videoError, setVideoError] = useState(false);
  const [alignment, setAlignment] = useState<AlignmentState>({ state: "none" });
  const [alignRequests, setAlignRequests] = useState(0);
  const [paused, setPaused] = useState(true);
  const [mouseActive, setMouseActive] = useState(false);
  const [lookupPause, setLookupPause] = useState(false);
  const [tokens, setTokens] = useState<CueToken[][]>([]);
  const [prefs, setPrefs] = useState(loadPlayerPrefs);
  const stoppedLine = useRef<number | null>(null);
  const anki = useAnkiWords();
  const mouseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const src = `/api/library/${episode.id}`;
  const cues = track?.cues ?? [];

  // For the key handler and seek guard, which outlive the render that created them.
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const lookupPauseRef = useRef(lookupPause);
  lookupPauseRef.current = lookupPause;
  const lastTime = useRef(0);
  const seekAllowed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${src}/subtitles`)
      .then((r) => r.json() as Promise<SubtitleTrack>)
      .then((t) => !cancelled && setTrack(t))
      .catch(() => !cancelled && setTrack({ source: null, cues: [] }));
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${src}/tokens`)
      .then((r) => r.json() as Promise<CueToken[][]>)
      .then((t) => !cancelled && setTokens(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Picks up an aligner run that's already going, and follows it until it finishes.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      fetch(`${src}/words`)
        .then((r) => r.json() as Promise<AlignmentState>)
        .then((next) => {
          if (cancelled) return;
          setAlignment(next);
          if (next.state === "running" || next.state === "queued") timer = setTimeout(poll, ALIGNMENT_POLL_MS);
        })
        .catch(() => {});
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [src, alignRequests]);

  function prepareWords() {
    setAlignment({ state: "queued" });
    // Polling waits for the request, or it could read the old state and stop.
    void fetch(`${src}/align`, { method: "POST" }).finally(() => setAlignRequests((n) => n + 1));
  }

  function keepControlsUp() {
    clearTimeout(mouseTimer.current);
    setMouseActive(true);
    const lower = () => {
      // Stay put while the mouse is on the subtitle, so it doesn't slide out from under a lookup.
      if (stageRef.current?.querySelector(".overlay:hover")) mouseTimer.current = setTimeout(lower, CONTROLS_VISIBLE_MS);
      else setMouseActive(false);
    };
    mouseTimer.current = setTimeout(lower, CONTROLS_VISIBLE_MS);
  }

  useEffect(() => () => clearTimeout(mouseTimer.current), []);

  /** Holds the line still for a lookup. Needs real movement, so a parked cursor doesn't pause every line. */
  function pauseForLookup(e: React.MouseEvent) {
    const video = videoRef.current;
    if (!video || video.paused || (e.movementX === 0 && e.movementY === 0)) return;
    video.pause();
    setLookupPause(true);
  }

  /** Plays from the start of a line, even if paused, since the point is to hear it. */
  function playLine(index: number | null) {
    const video = videoRef.current;
    const cue = index === null ? undefined : cuesRef.current[index];
    if (!video || !cue) return;
    seekAllowed.current = true;
    stoppedLine.current = null;
    video.currentTime = cue.start + offsetRef.current;
    void video.play();
  }

  useEffect(() => savePlayerPrefs(prefs), [prefs]);

  // Every frame, because the video's own time updates could overrun into the next line.
  useEffect(() => {
    if (!prefs.study) return;
    let frame = requestAnimationFrame(function tick() {
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking) {
        const line = lineToStopAt(cuesRef.current, video.currentTime - offsetRef.current, stoppedLine.current);
        if (line !== null) {
          stoppedLine.current = line;
          video.pause();
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [prefs.study]);

  function videoTime(): number {
    return (videoRef.current?.currentTime ?? 0) - offsetRef.current;
  }

  function replayLine() {
    playLine(latestLine(cuesRef.current, videoTime()));
  }

  // Works in fullscreen, where the buttons under the video are out of reach.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as Element).closest("input, textarea, select")) return;
      const key = e.key.toLowerCase();
      if (key === "r") replayLine();
      else if (key === "q") playLine(stepLine(cuesRef.current, videoTime(), -1));
      else if (key === "e") playLine(stepLine(cuesRef.current, videoTime(), 1));
      else if (key === "s") setPrefs((p) => ({ ...p, subtitles: !p.subtitles }));
      else if (key === "m") setPrefs((p) => ({ ...p, study: !p.study }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /** Puts the video back if something other than the viewer moves it during a lookup. */
  function holdPlaceDuringLookup(video: HTMLVideoElement) {
    const lookingUp = lookupPauseRef.current || document.querySelector("iframe:hover") !== null;
    if (seekAllowed.current || !lookingUp || Math.abs(video.currentTime - lastTime.current) < 1) return;
    console.warn(`Hitaru: undid a jump from ${lastTime.current}s to ${video.currentTime}s during a lookup`);
    video.currentTime = lastTime.current;
  }

  // Resumes once the mouse leaves both the subtitle and Yomitan's popup, which is an iframe.
  useEffect(() => {
    if (!lookupPause) return;
    const resume = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target instanceof HTMLIFrameElement || target.closest(".overlay")) return;
      setLookupPause(false);
      void videoRef.current?.play();
    };
    document.addEventListener("mouseover", resume);
    return () => document.removeEventListener("mouseover", resume);
  }, [lookupPause]);

  // Counts only real playback: not paused, seeking, buffering, or finished.
  useEffect(() => {
    let last = Date.now();
    let lastSave = last;
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min(now - last, MAX_TICK_MS);
      last = now;
      const video = videoRef.current;
      if (video && !video.paused && !video.seeking && !video.ended && video.readyState >= 3) {
        setProgress((p) => ({ ...p, activeMs: p.activeMs + elapsed }));
      }
      if (now - lastSave >= SAVE_EVERY_MS) {
        lastSave = now;
        saveProgress(episode.show, progressRef.current);
        // Still 0 until the video loads, which would lose the place on a reload.
        if (video && video.currentTime > 0) savePosition(episode.id, video.currentTime);
      }
    }, 1000);
    return () => {
      clearInterval(interval);
      saveProgress(episode.show, progressRef.current);
    };
  }, [episode.id, episode.show]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video && video.currentTime > 0) savePosition(episode.id, video.currentTime);
    };
  }, [episode.id]);

  function scrollToCue(index: number) {
    const list = transcriptRef.current;
    const item = list?.children[index] as HTMLElement | undefined;
    if (!list || !item) return;
    const top = item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2;
    // Glide between neighbouring lines, but go straight there after a long jump.
    const near = Math.abs(top - list.scrollTop) < list.clientHeight;
    list.scrollTo({ top, behavior: near ? "smooth" : "auto" });
  }

  /** Returns the line to keep in view: the current one, or the next one during a gap. */
  function syncCue(): number {
    const video = videoRef.current;
    if (!video) return -1;
    const time = video.currentTime - offset;
    const index = findCue(cues, time);
    setCueIndex(index);
    const target = index >= 0 ? index : cues.findIndex((cue) => cue.start > time);
    setFollowIndex(target);
    const cue = cues[index];
    if (cue && !video.paused) {
      const key = `${episode.id}:${index}`;
      setProgress((p) => (key in p.lines ? p : { ...p, lines: { ...p.lines, [key]: cue.text } }));
    }
    return target;
  }

  useEffect(() => {
    // Hovering counts as reading: scrolling now would pull the line out from under a lookup.
    if (transcriptRef.current?.matches(":hover")) return;
    if (Date.now() - lastManualScroll.current >= FOLLOW_PAUSE_MS) scrollToCue(followIndex);
  }, [followIndex]);

  // Subtitles usually load after a resumed video has already seeked.
  useEffect(() => {
    if (track) scrollToCue(syncCue());
  }, [track]);

  const stats = useMemo(
    () => subtitleStats(Object.values(progress.lines), progress.activeMs, 10),
    [progress.lines, progress.activeMs >= 60_000],
  );

  const episodeScore = useMemo(() => understanding(tokens, anki.known), [tokens, anki.known]);
  // During a gap followIndex is the upcoming line, which hasn't been heard yet.
  // It's -1 only past the last line, since it's set as soon as the subtitles load.
  const heardCount = followIndex === -1 ? cues.length : followIndex + (cueIndex >= 0 ? 1 : 0);
  const heardScore = useMemo(
    () => understanding(tokens.slice(0, heardCount), anki.known),
    [tokens, heardCount, anki.known],
  );

  function changeOffset(delta: number) {
    const next = Math.round((offset + delta) * 100) / 100;
    setOffset(next);
    saveOffset(episode.id, next);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  }

  const current = cues[cueIndex];

  return (
    <div className="player">
      <div className="player-main">
        {/* Fullscreening this wrapper, not the video, keeps the subtitles on screen. */}
        <div
          ref={stageRef}
          className={paused || mouseActive ? "stage controls-up" : "stage"}
          onMouseMove={keepControlsUp}
          onMouseLeave={() => {
            clearTimeout(mouseTimer.current);
            setMouseActive(false);
          }}
        >
          <video
            ref={videoRef}
            src={`${src}/video`}
            controls
            controlsList="nofullscreen"
            playsInline
            onLoadedMetadata={(e) => {
              const video = e.currentTarget;
              const position = loadPosition(episode.id);
              if (position > 0 && position < video.duration - RESTART_NEAR_END_SECONDS) {
                video.currentTime = position;
              }
            }}
            onPlay={() => {
              setPaused(false);
              setLookupPause(false);
            }}
            onPause={() => setPaused(true)}
            onTimeUpdate={(e) => {
              if (!e.currentTarget.seeking) lastTime.current = e.currentTarget.currentTime;
              syncCue();
            }}
            onSeeking={(e) => {
              stoppedLine.current = null;
              holdPlaceDuringLookup(e.currentTarget);
            }}
            onSeeked={() => {
              seekAllowed.current = false;
              // A seek always brings the list along, even right after a manual scroll.
              lastManualScroll.current = 0;
              scrollToCue(syncCue());
            }}
            onEnded={() => {
              savePosition(episode.id, 0);
              onEnded();
            }}
            onError={() => setVideoError(true)}
          />
          {current && prefs.subtitles && (
            <Overlay
              key={cueIndex}
              text={current.text}
              words={alignment.state === "ready" ? alignment.cues[cueIndex] ?? null : null}
              tokens={tokens[cueIndex]}
              known={anki.known}
              offset={offset}
              video={videoRef}
              onMouseMove={pauseForLookup}
            />
          )}
          {cues.length > 0 && (
            <button
              type="button"
              className="replay-line"
              title="Replay this line (R). Previous line: Q. Next line: E. Subtitles: S. Mode: M."
              onClick={(e) => {
                replayLine();
                // Otherwise Space would replay again instead of pausing.
                e.currentTarget.blur();
              }}
            >
              ↺ Replay line
            </button>
          )}
        </div>

        {videoError && (
          <p className="banner" role="alert">
            This browser couldn't play the video. Chrome and Edge handle the most formats.
          </p>
        )}

        <div className="player-tools">
          <span className="secondary">
            {track === null
              ? "Finding subtitles…"
              : track.source
                ? `Subtitles: ${track.source}`
                : "No Japanese subtitles found for this video"}
          </span>
          <span className="player-buttons">
            {cues.length > 0 && alignment.state === "none" && (
              <button type="button" onClick={prepareWords}>Prepare word highlighting</button>
            )}
            {alignment.state === "queued" && <span className="secondary">Word highlighting: waiting…</span>}
            {alignment.state === "running" && (
              <span className="secondary">
                Word highlighting: {alignment.done > 0 ? `${alignment.done} of ${alignment.total} lines` : "starting…"}
              </span>
            )}
            {alignment.state === "failed" && (
              <button type="button" title={alignment.message} onClick={prepareWords}>Word highlighting failed. Retry</button>
            )}
            {cues.length > 0 && (
              <>
                <button
                  type="button"
                  aria-pressed={prefs.subtitles}
                  title="Show or hide subtitles (S)"
                  onClick={() => setPrefs((p) => ({ ...p, subtitles: !p.subtitles }))}
                >
                  Subtitles: {prefs.subtitles ? "on" : "off"}
                </button>
                <span className="mode-toggle" role="group" aria-label="Playback mode">
                  <button
                    type="button"
                    aria-pressed={!prefs.study}
                    title="Play straight through (M switches)"
                    onClick={() => setPrefs((p) => ({ ...p, study: false }))}
                  >
                    Immersion
                  </button>
                  <button
                    type="button"
                    aria-pressed={prefs.study}
                    title="Pause at the end of every line (M switches)"
                    onClick={() => setPrefs((p) => ({ ...p, study: true }))}
                  >
                    Study
                  </button>
                </span>
              </>
            )}
            {cues.length > 0 && (
              <span className="offset">
                <button type="button" aria-label="Show subtitles earlier" onClick={() => changeOffset(-OFFSET_STEP)}>−</button>
                <span className="secondary">Timing {offset > 0 ? "+" : ""}{offset.toFixed(2)}s</span>
                <button type="button" aria-label="Show subtitles later" onClick={() => changeOffset(OFFSET_STEP)}>+</button>
              </span>
            )}
            <button type="button" onClick={toggleFullscreen}>Fullscreen</button>
          </span>
        </div>

        {episodeScore.words > 0 && (
          <section className="panel">
            <div className="live-header">
              <h2>Words you know</h2>
              <span className="status">
                <span className={anki.source === "live" ? "status-dot on" : "status-dot"} />
                {anki.source === "live" && `${anki.count} green cards from Anki`}
                {anki.source === "saved" && `Anki is closed: using ${anki.count} saved green cards`}
                {anki.source === "none" && "Open Anki to load your green cards"}
                {anki.source === "loading" && "Checking Anki…"}
              </span>
            </div>
            <dl className="live-stats">
              <div><dt>This episode</dt><dd>{percent(episodeScore.knownWords, episodeScore.words)}</dd></div>
              <div><dt>Heard so far</dt><dd>{percent(heardScore.knownWords, heardScore.words)}</dd></div>
              <div><dt>Fully known lines</dt><dd>{percent(episodeScore.knownLines, episodeScore.lines)}</dd></div>
            </dl>
            <p className="secondary score-note">
              {episodeScore.knownWords.toLocaleString()} of {episodeScore.words.toLocaleString()} vocabulary words.
              Leaves out particles, grammar endings, names, numbers and sounds like うん.
            </p>
          </section>
        )}

        <WordsToLearn
          episodeId={episode.id}
          cues={cues}
          tokens={tokens}
          known={anki.known}
          inAnki={anki.inAnki}
          offset={offset}
          onPlay={playLine}
        />

        <section className="panel">
          <div className="live-header">
            <h2>Not logged yet: {episode.show}</h2>
          </div>
          <dl className="live-stats">
            <div><dt>Watch time</dt><dd>{formatMinutes(progress.activeMs / 60_000)}</dd></div>
            <div><dt>Lines</dt><dd>{Object.keys(progress.lines).length.toLocaleString()}</dd></div>
            <div><dt>Words</dt><dd>{stats.words.toLocaleString()}</dd></div>
            <div><dt>Unique words</dt><dd>{stats.uniqueWords.toLocaleString()}</dd></div>
            <div><dt>Words a minute</dt><dd>{stats.wordsPerMinute || "—"}</dd></div>
          </dl>
          {stats.topWords.length > 0 && (
            <div className="top-words">
              <h3>Most repeated words</h3>
              <ul lang="ja">
                {stats.topWords.map(({ word, count }) => (
                  <li key={word}>{word} <span className="secondary">{count}</span></li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className="primary"
            disabled={progress.activeMs < 1000}
            onClick={() => {
              saveProgress(episode.show, progressRef.current);
              const heard = heardTokens(Object.keys(progress.lines), episode.id, tokens);
              onSendToLog(episode.show, Math.min(1440, Math.max(1, Math.round(progress.activeMs / 60_000))), {
                episode: episode.name,
                lines: Object.keys(progress.lines).length,
                words: stats.words,
                uniqueWords: stats.uniqueWords,
                // With no list from Anki, everything would wrongly count as unknown.
                understanding: anki.source === "live" || anki.source === "saved" ? understanding(heard, anki.known) : null,
              });
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

      {cues.length > 0 && (
        <ol
          ref={transcriptRef}
          className={prefs.subtitles ? "cue-list panel" : "cue-list panel subtitles-off"}
          lang="ja"
          aria-label="Subtitles"
          onWheel={() => (lastManualScroll.current = Date.now())}
          onTouchMove={() => (lastManualScroll.current = Date.now())}
        >
          {cues.map((cue, i) => (
            <li key={i} className={i === cueIndex ? "active" : undefined} aria-current={i === cueIndex || undefined}>
              <button
                type="button"
                className="cue-time"
                aria-label={`Jump to ${clock(cue.start)}`}
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = cue.start + offset;
                }}
              >
                {clock(cue.start)}
              </button>
              <span><CueText text={cue.text} tokens={tokens[i]} known={anki.known} /></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
