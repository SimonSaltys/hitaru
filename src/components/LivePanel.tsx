import { useLayoutEffect, useMemo, useRef } from "react";
import type { CaptureSnapshot } from "../../bridge/capture";
import { formatMinutes } from "../lib/stats";
import { cleanTitle, subtitleStats } from "../lib/subtitles";

const NEAR_BOTTOM_PX = 40;

function statusText(capture: CaptureSnapshot): string {
  if (!capture.connected) return "mpv not connected";
  return capture.playing ? "Playing" : "Paused";
}

export function LivePanel(props: {
  capture: CaptureSnapshot;
  activeMs: number;
  onSendToLog: () => void;
  onDiscard: () => void;
  onRemoveLine: (id: number) => void;
}) {
  const { capture, activeMs, onSendToLog, onDiscard, onRemoveLine } = props;
  const lineCount = capture.lines.length;
  const hasCapture = lineCount > 0 || activeMs > 0;

  // Recomputed per line rather than per tick, so the pace can lag by a few seconds.
  const latestMs = useRef(activeMs);
  latestMs.current = activeMs;
  const stats = useMemo(
    () => subtitleStats(capture.lines.map((l) => l.text), latestMs.current),
    [capture.lines],
  );

  // Follow new lines, unless you've scrolled up to look something up.
  const scroller = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (scroller.current && following.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [lineCount]);

  // mpv is optional now that the Watch page has a player, so stay hidden until it is used.
  if (!hasCapture && !capture.connected) return null;

  return (
    <section className="panel live">
      <div className="live-header">
        <h2>Watching in mpv</h2>
        <span className="status">
          <span className={capture.connected ? "status-dot on" : "status-dot"} aria-hidden="true" />
          {statusText(capture)}
        </span>
      </div>

      {!hasCapture && capture.connected && (
        <p className="secondary">Connected. Play something with Japanese subtitles turned on.</p>
      )}

      {hasCapture && (
        <>
          <p className="live-title" lang="ja">{cleanTitle(capture.title) || "Untitled"}</p>
          <dl className="live-stats">
            <div><dt>Watch time</dt><dd>{formatMinutes(activeMs / 60_000)}</dd></div>
            <div><dt>Lines</dt><dd>{lineCount.toLocaleString()}</dd></div>
            <div><dt>Words</dt><dd>{stats.words.toLocaleString()}</dd></div>
            <div><dt>Unique words</dt><dd>{stats.uniqueWords.toLocaleString()}</dd></div>
            <div><dt>Words a minute</dt><dd>{stats.wordsPerMinute || "—"}</dd></div>
          </dl>

          {lineCount > 0 && (
            <ol
              ref={scroller}
              className="transcript"
              lang="ja"
              tabIndex={0}
              aria-label="Subtitle lines"
              onScroll={(e) => {
                const el = e.currentTarget;
                following.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
              }}
            >
              {capture.lines.map((line) => (
                <li key={line.id}>
                  <span>{line.text}</span>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Remove line: ${line.text}`}
                    onClick={() => onRemoveLine(line.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}

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

          <div className="form-actions">
            <button type="button" className="primary" onClick={onSendToLog}>Send to log</button>
            <button type="button" className="ghost" onClick={onDiscard}>Discard</button>
          </div>
        </>
      )}
    </section>
  );
}
