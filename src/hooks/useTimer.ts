import { useCallback, useEffect, useState } from "react";

const TIMER_KEY = "hitaru.timer.v1";

interface TimerState {
  /** Time banked before the current run. */
  accumulatedMs: number;
  /** Epoch ms when the current run began; null while paused. */
  runningSince: number | null;
}

const STOPPED: TimerState = { accumulatedMs: 0, runningSince: null };

function load(): TimerState {
  try {
    const raw = localStorage.getItem(TIMER_KEY);
    return raw ? (JSON.parse(raw) as TimerState) : STOPPED;
  } catch {
    return STOPPED;
  }
}

/** A timer stored as timestamps, so it keeps counting through reloads and closed tabs. */
export function useTimer() {
  const [state, setState] = useState(load);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    try {
      localStorage.setItem(TIMER_KEY, JSON.stringify(state));
    } catch {
      // The timer still works for this page view without persistence.
    }
  }, [state]);

  useEffect(() => {
    if (state.runningSince === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.runningSince]);

  const elapsedMs =
    state.accumulatedMs + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince));

  const start = useCallback(() => {
    setState((s) => (s.runningSince === null ? { ...s, runningSince: Date.now() } : s));
  }, []);

  const pause = useCallback(() => {
    setState((s) =>
      s.runningSince === null
        ? s
        : { accumulatedMs: s.accumulatedMs + Date.now() - s.runningSince, runningSince: null },
    );
  }, []);

  const reset = useCallback(() => setState(STOPPED), []);

  return { elapsedMs, running: state.runningSince !== null, start, pause, reset };
}
