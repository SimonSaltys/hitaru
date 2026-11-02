import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTimer } from "../hooks/useTimer";
import { toKey } from "../lib/dates";
import { rankBy } from "../lib/stats";
import { CATEGORIES, COMPREHENSION_LABELS, type Category, type Session } from "../lib/types";

const QUICK_MINUTES = [15, 30, 45, 60];

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

export function LogPanel(props: {
  sessions: Session[];
  today: Date;
  editing: Session | null;
  prefill: { title: string; minutes: number } | null;
  onSave: (session: Omit<Session, "id">) => void;
  onCancelEdit: () => void;
}) {
  const { sessions, today, editing, prefill, onSave, onCancelEdit } = props;
  const timer = useTimer();

  const [date, setDate] = useState(toKey(today));
  const [minutes, setMinutes] = useState("");
  const [category, setCategory] = useState<Category>("Anime & TV");
  const [title, setTitle] = useState("");
  const [comprehension, setComprehension] = useState<number | null>(null);

  useEffect(() => {
    if (!editing) {
      reset();
      return;
    }
    setDate(editing.date);
    setMinutes(String(editing.minutes));
    setCategory(editing.category);
    setTitle(editing.title);
    setComprehension(editing.comprehension);
  }, [editing]);

  useEffect(() => {
    if (!prefill) return;
    changeTitle(prefill.title);
    setMinutes(String(prefill.minutes));
    setDate(toKey(today));
    // Only a new prefill should overwrite what's in the form.
  }, [prefill]);

  // Keep the default date current if the page stays open past midnight.
  const todayKey = toKey(today);
  useEffect(() => {
    setDate((d) => (minutes === "" && !editing ? todayKey : d));
  }, [todayKey]);

  const knownTitles = useMemo(() => rankBy(sessions, (s) => s.title).map((t) => t.name), [sessions]);

  function reset() {
    setDate(todayKey);
    setMinutes("");
    setTitle("");
    setComprehension(null);
  }

  function changeTitle(value: string) {
    setTitle(value);
    const previous = sessions.find((s) => s.title === value);
    if (previous) setCategory(previous.category);
  }

  function finishTimer() {
    setMinutes(String(Math.min(1440, Math.max(1, Math.round(timer.elapsedMs / 60000)))));
    setDate(todayKey);
    timer.reset();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({
      date,
      minutes: Number(minutes),
      category,
      title: title.trim(),
      comprehension,
    });
    reset();
  }

  return (
    <section className="panel log-panel" aria-label="Log a session">
      <div className="timer">
        <span className="timer-clock">{clock(timer.elapsedMs)}</span>
        <div className="timer-actions">
          {timer.running ? (
            <button type="button" onClick={timer.pause}>Pause</button>
          ) : (
            <button type="button" onClick={timer.start}>
              {timer.elapsedMs > 0 ? "Resume" : "Start timer"}
            </button>
          )}
          {timer.elapsedMs > 0 && (
            <>
              <button type="button" className="primary" onClick={finishTimer}>Finish</button>
              <button type="button" className="ghost" onClick={timer.reset}>Discard</button>
            </>
          )}
        </div>
      </div>

      <form onSubmit={submit}>
        <h2>{editing ? "Edit session" : "Log a session"}</h2>

        <label className="field">
          What did you immerse in?
          <input
            value={title}
            list="known-titles"
            placeholder="Optional, e.g. 葬送のフリーレン"
            onChange={(e) => changeTitle(e.target.value)}
          />
          <datalist id="known-titles">
            {knownTitles.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>

        <div className="field-row">
          <label className="field">
            Type
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            Date
            <input
              type="date"
              required
              max={todayKey}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          Minutes
          <input
            type="number"
            required
            min={1}
            max={1440}
            step={1}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <div className="chips">
          {QUICK_MINUTES.map((m) => (
            <button
              type="button"
              key={m}
              className="chip"
              aria-pressed={minutes === String(m)}
              onClick={() => setMinutes(String(m))}
            >
              {m}
            </button>
          ))}
        </div>

        <fieldset className="field">
          <legend>How much did you understand? (optional)</legend>
          <div className="chips rating">
            {COMPREHENSION_LABELS.map((label, i) => (
              <button
                type="button"
                key={label}
                className="chip"
                aria-pressed={comprehension === i + 1}
                onClick={() => setComprehension(comprehension === i + 1 ? null : i + 1)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="primary">{editing ? "Save changes" : "Add session"}</button>
          {editing && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                reset();
                onCancelEdit();
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
