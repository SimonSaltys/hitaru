import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ComprehensionChart, Heatmap, RankedBars, WeeklyChart } from "./components/Charts";
import { History } from "./components/History";
import { LivePanel } from "./components/LivePanel";
import { LogPanel } from "./components/LogPanel";
import { Summary } from "./components/Summary";
import { Tooltip } from "./components/Tooltip";
import { WatchPage } from "./components/WatchPage";
import { clearProgress, loadProgress, saveProgress } from "./lib/watchProgress";
import { useMpvCapture } from "./hooks/useMpvCapture";
import { cleanTitle } from "./lib/subtitles";
import { fromKey, longDate, shortDate, toKey } from "./lib/dates";
import { crossedMilestone, formatMinutes, rankBy, totalMinutes, weeklyStats } from "./lib/stats";
import {
  addNewSessions,
  getDataPath,
  loadData,
  mergeSessions,
  newId,
  parseData,
  refreshData,
  SaveConflict,
  saveData,
  updateData,
} from "./lib/storage";
import type { AppData, Session, Settings } from "./lib/types";

const CHART_WEEKS = 12;

interface Toast {
  message: string;
  undo?: () => void;
}

function useHashView(): "log" | "watch" {
  const read = () => (window.location.hash === "#/watch" ? "watch" : "log");
  const [view, setView] = useState<"log" | "watch">(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return view;
}

function useToday(): Date {
  const [key, setKey] = useState(() => toKey(new Date()));
  useEffect(() => {
    const check = () => setKey(toKey(new Date()));
    const interval = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return useMemo(() => fromKey(key), [key]);
}

export function App() {
  const [{ data, loadError }, setLoaded] = useState<{ data: AppData | null; loadError: boolean }>({
    data: null,
    loadError: false,
  });

  useEffect(() => {
    loadData()
      .then((loaded) => setLoaded({ data: loaded, loadError: false }))
      .catch(() => setLoaded({ data: null, loadError: true }));
  }, []);

  // Another tab or address may have saved while this one was in the background.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      refreshData()
        .then((latest) => latest && setLoaded({ data: latest, loadError: false }))
        .catch(() => setLoaded({ data: null, loadError: true }));
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (loadError) {
    return (
      <main className="page">
        <div className="panel">
          <h1>Your saved data couldn't be read</h1>
          <p>
            Nothing has been changed or overwritten. Your log is in{" "}
            <code>{getDataPath() || "Documents\\Hitaru\\hitaru-data.json"}</code>, with daily
            copies in the <code>backups</code> folder beside it.
          </p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page">
        <p className="secondary">Loading your log…</p>
      </main>
    );
  }

  return (
    <Tracker
      data={data}
      setData={(next) => setLoaded({ data: next, loadError: false })}
    />
  );
}

function Tracker({ data, setData }: { data: AppData; setData: (data: AppData) => void }) {
  const today = useToday();
  const [editing, setEditing] = useState<Session | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { sessions, settings } = data;
  const mpv = useMpvCapture();
  const view = useHashView();
  const [capturePrefill, setCapturePrefill] = useState<{
    title: string;
    minutes: number;
    onSaved: () => void;
  } | null>(null);

  function sendCaptureToLog() {
    setEditing(null);
    setCapturePrefill({
      title: cleanTitle(mpv.capture.title),
      minutes: Math.min(1440, Math.max(1, Math.round(mpv.activeMs / 60_000))),
      onSaved: mpv.reset,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Logs straight away, then opens the new session in the form so it can still be rated. */
  function sendWatchToLog(show: string, minutes: number) {
    const unlogged = loadProgress(show);
    const session: Session = {
      id: newId(),
      date: toKey(new Date()),
      minutes,
      category: "Anime & TV",
      title: show,
      comprehension: null,
    };
    const nextSessions = [...sessions, session];
    commit({ ...data, sessions: nextSessions });
    clearProgress(show);
    setCapturePrefill(null);
    setEditing(session);
    setToast({
      message: addedMessage(nextSessions, minutes),
      undo: () => {
        commit(data);
        saveProgress(show, unlogged);
        setEditing(null);
      },
    });
    window.location.hash = "#/";
    window.scrollTo({ top: 0 });
  }

  function addedMessage(nextSessions: Session[], minutes: number): string {
    const crossed = crossedMilestone(
      totalMinutes(sessions, settings.priorHours) / 60,
      totalMinutes(nextSessions, settings.priorHours) / 60,
    );
    return crossed
      ? `You've reached ${crossed.toLocaleString()} hours of immersion. おめでとう!`
      : `Added ${formatMinutes(minutes)}`;
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timeout);
  }, [toast]);

  function commit(next: AppData) {
    setData(next);
    saveData(next)
      .then(() => setSaveFailed(false))
      .catch((error: unknown) => {
        if (error instanceof SaveConflict) {
          setData(error.data);
          setEditing(null);
          setToast({ message: "The log was changed in another tab, so your last change wasn't saved. Please redo it." });
        } else {
          setSaveFailed(true);
        }
      });
  }

  // Sessions logged from the browser extension. It keeps them until told they're saved.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const message = e.data as { type?: string; sessions?: { id?: unknown }[] } | null;
      if (message?.type !== "hitaru:log" || !Array.isArray(message.sessions)) return;
      const incoming = message.sessions;
      let added = 0;
      // Merged into the latest log on disk, since another tab may have just saved the same delivery.
      updateData((latest) => {
        const sessions = addNewSessions(latest.sessions, incoming);
        added = sessions.length - latest.sessions.length;
        return { ...latest, sessions };
      })
        .then((saved) => {
          setData(saved);
          if (added > 0) {
            setToast({ message: `Added ${added} YouTube ${added === 1 ? "session" : "sessions"} from the extension` });
          }
          window.postMessage({ type: "hitaru:logged", ids: incoming.map((s) => s.id) }, window.location.origin);
        })
        // Unacknowledged, so the extension keeps them and tries again next time.
        .catch(() => setSaveFailed(true));
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "hitaru:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function saveSession(fields: Omit<Session, "id">) {
    if (editing) {
      commit({
        ...data,
        sessions: sessions.map((s) => (s.id === editing.id ? { ...fields, id: editing.id } : s)),
      });
      setEditing(null);
      setToast({ message: "Session updated" });
      return;
    }
    const nextSessions = [...sessions, { ...fields, id: newId() }];
    commit({ ...data, sessions: nextSessions });
    // The capture is cleared only now, so it isn't lost if the form is abandoned.
    if (capturePrefill) {
      capturePrefill.onSaved();
      setCapturePrefill(null);
    }
    setToast({ message: addedMessage(nextSessions, fields.minutes) });
  }

  function deleteSession(session: Session) {
    commit({ ...data, sessions: sessions.filter((s) => s.id !== session.id) });
    if (editing?.id === session.id) setEditing(null);
    setToast({ message: "Session deleted", undo: () => commit(data) });
  }

  function updateSettings(change: Partial<Settings>) {
    commit({ ...data, settings: { ...settings, ...change } });
  }

  function exportBackup() {
    const stamped = { ...data, lastBackup: toKey(new Date()) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(stamped, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hitaru-backup-${stamped.lastBackup}.json`;
    link.click();
    URL.revokeObjectURL(url);
    commit(stamped);
  }

  async function importBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const incoming = parseData(await file.text());
      commit({
        ...data,
        sessions: mergeSessions(sessions, incoming.sessions),
        settings: incoming.settings,
      });
      setToast({ message: `Imported ${incoming.sessions.length} ${incoming.sessions.length === 1 ? "session" : "sessions"}` });
    } catch {
      setToast({ message: "That file isn't a valid Hitaru backup. Nothing was changed." });
    }
  }

  const weeks = useMemo(() => weeklyStats(sessions, today, CHART_WEEKS), [sessions, today]);
  const byCategory = useMemo(() => rankBy(sessions, (s) => s.category), [sessions]);
  const byTitle = useMemo(() => rankBy(sessions, (s) => s.title).slice(0, 7), [sessions]);

  return (
    <main className="page">
      <header className="masthead">
        <h1><span lang="ja">浸る</span> Hitaru</h1>
        <p className="secondary">Japanese immersion log</p>
        <nav className="nav" aria-label="Pages">
          <a href="#/" aria-current={view === "log" ? "page" : undefined}>Log</a>
          <a href="#/watch" aria-current={view === "watch" ? "page" : undefined}>Watch</a>
        </nav>
      </header>

      {saveFailed && (
        <p className="banner" role="alert">
          Your last change couldn't be saved to disk. Export a backup before closing this page.
        </p>
      )}

      {view === "watch" ? (
        <WatchPage onSendToLog={sendWatchToLog} />
      ) : (
        <>
      <Summary sessions={sessions} settings={settings} today={today} />

      <LivePanel
        capture={mpv.capture}
        activeMs={mpv.activeMs}
        onSendToLog={sendCaptureToLog}
        onDiscard={mpv.reset}
        onRemoveLine={mpv.removeLine}
      />

      <div className="columns">
        <LogPanel
          sessions={sessions}
          today={today}
          editing={editing}
          prefill={capturePrefill}
          onSave={saveSession}
          onCancelEdit={() => setEditing(null)}
        />
        <div className="stack">
          <section className="panel">
            <h2>Hours per week</h2>
            <WeeklyChart weeks={weeks} goalHours={settings.weeklyGoalHours} />
          </section>
          <section className="panel">
            <h2>Comprehension per week</h2>
            <ComprehensionChart weeks={weeks} />
            <details className="table-view">
              <summary>View weekly numbers</summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Week of</th><th className="num">Time</th><th className="num">Comprehension</th></tr>
                  </thead>
                  <tbody>
                    {[...weeks].reverse().map((w) => (
                      <tr key={w.start.getTime()}>
                        <td>{shortDate(w.start)}</td>
                        <td className="num">{formatMinutes(w.minutes)}</td>
                        <td className="num">{w.comprehension === null ? "—" : w.comprehension.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </div>
      </div>

      <section className="panel">
        <h2>Every day you showed up</h2>
        <Heatmap sessions={sessions} today={today} />
      </section>

      <div className="columns even">
        <section className="panel">
          <h2>By type</h2>
          <RankedBars rows={byCategory} empty="Log a session to see where your time goes." />
        </section>
        <section className="panel">
          <h2>Top titles</h2>
          <RankedBars rows={byTitle} empty="Add titles to your sessions to rank them here." />
        </section>
      </div>

      <section className="panel">
        <h2>History</h2>
        <History
          sessions={sessions}
          onEdit={(s) => {
            setEditing(s);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onDelete={deleteSession}
        />
      </section>

      <section className="panel settings">
        <h2>Settings and backup</h2>
        <div className="field-row">
          <label className="field">
            Weekly goal (hours)
            <input
              type="number"
              min={0}
              step={0.5}
              value={settings.weeklyGoalHours}
              onChange={(e) => updateSettings({ weeklyGoalHours: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          <label className="field">
            Hours before using Hitaru
            <input
              type="number"
              min={0}
              step={1}
              value={settings.priorHours}
              onChange={(e) => updateSettings({ priorHours: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </div>
        <p className="backup-note secondary">
          Your log is saved in <code>{getDataPath()}</code>, with a daily copy kept for 30 days.{" "}
          {data.lastBackup && `Last export: ${longDate(fromKey(data.lastBackup))}.`}
        </p>
        <div className="form-actions">
          <button type="button" onClick={exportBackup}>Export backup</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Import backup</button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importBackup} />
        </div>
      </section>
        </>
      )}

      <Tooltip />
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </main>
  );
}
