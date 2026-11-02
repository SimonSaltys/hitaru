import { useCallback, useEffect, useState } from "react";
import type { CaptureEvent, CaptureSnapshot } from "../../bridge/capture";

const EMPTY: CaptureSnapshot = {
  connected: false,
  title: null,
  playing: false,
  activeMs: 0,
  lines: [],
};

/** Follows the server's mpv capture, ticking watch time locally between its updates. */
export function useMpvCapture() {
  const [capture, setCapture] = useState(EMPTY);
  const [receivedAt, setReceivedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const source = new EventSource("/api/mpv/events");
    source.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as CaptureEvent;
      if (event.type === "line") {
        setCapture((c) => ({ ...c, lines: [...c.lines, event.line] }));
      } else {
        setCapture(event.snapshot);
        setReceivedAt(Date.now());
        setNow(Date.now());
      }
    };
    // EventSource reconnects by itself; until then mpv is effectively unreachable.
    source.onerror = () => setCapture((c) => ({ ...c, connected: false, playing: false }));
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!capture.playing) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [capture.playing]);

  const reset = useCallback(() => {
    void fetch("/api/mpv/reset", { method: "POST" });
  }, []);

  const removeLine = useCallback((id: number) => {
    void fetch(`/api/mpv/lines/${id}/delete`, { method: "POST" });
  }, []);

  const activeMs = capture.activeMs + (capture.playing ? Math.max(0, now - receivedAt) : 0);

  return { capture, activeMs, reset, removeLine };
}
