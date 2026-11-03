import { useWidth } from "../hooks/useWidth";
import { addDays, fromKey, longDate, shortDate, startOfWeek, toKey } from "../lib/dates";
import { formatMinutes, minutesByDay, type WeekStats } from "../lib/stats";
import { COMPREHENSION_LABELS, type Session } from "../lib/types";

const PLOT = { top: 16, right: 12, bottom: 24, left: 34 };

function topRoundedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

function niceStep(max: number): number {
  return [1, 2, 5, 10, 20, 50, 100].find((step) => max / step <= 4) ?? 200;
}

/** Thins x labels so they never collide at narrow widths. */
function labelStride(bandWidth: number): number {
  return Math.max(1, Math.ceil(52 / bandWidth));
}

export function WeeklyChart({ weeks, goalHours }: { weeks: WeekStats[]; goalHours: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 200;
  const plotW = width - PLOT.left - PLOT.right;
  const plotH = height - PLOT.top - PLOT.bottom;
  const maxHours = Math.max(goalHours, ...weeks.map((w) => w.minutes / 60), 1);
  const step = niceStep(maxHours);
  const top = Math.ceil(maxHours / step) * step;
  const y = (hours: number) => PLOT.top + plotH - (hours / top) * plotH;
  const band = plotW / weeks.length;
  const barW = Math.min(24, Math.max(4, band - 4));
  const stride = labelStride(band);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const lastIndex = weeks.length - 1;

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Hours immersed per week, with the weekly goal. Values are in the table below.">
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "axis" : "grid"} x1={PLOT.left} x2={width - PLOT.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PLOT.left - 6} y={y(t) + 4} textAnchor="end">{t}h</text>
            </g>
          ))}
          {goalHours > 0 && (
            <g>
              <line className="goal" x1={PLOT.left} x2={width - PLOT.right} y1={y(goalHours)} y2={y(goalHours)} />
              <text className="tick halo" x={PLOT.left + 4} y={y(goalHours) - 5}>Goal {goalHours}h</text>
            </g>
          )}
          {weeks.map((week, i) => {
            const cx = PLOT.left + band * (i + 0.5);
            const hours = week.minutes / 60;
            const barH = plotH - (y(hours) - PLOT.top);
            const showLabel = (lastIndex - i) % stride === 0;
            return (
              <g key={week.start.getTime()}>
                {week.minutes > 0 && (
                  <path className="bar" d={topRoundedBar(cx - barW / 2, y(hours), barW, barH)} />
                )}
                {i === lastIndex && week.minutes > 0 && (
                  <text className="value halo" x={Math.min(cx, width - PLOT.right - 12)} y={y(hours) - 5} textAnchor="middle">
                    {formatMinutes(week.minutes)}
                  </text>
                )}
                {showLabel && (
                  <text className="tick" x={cx} y={height - 6} textAnchor="middle">{shortDate(week.start)}</text>
                )}
                <rect
                  className="hit"
                  x={PLOT.left + band * i}
                  y={PLOT.top}
                  width={band}
                  height={plotH}
                  tabIndex={0}
                  aria-label={`Week of ${shortDate(week.start)}: ${formatMinutes(week.minutes)}`}
                  data-tip={`Week of ${shortDate(week.start)}: ${formatMinutes(week.minutes)}`}
                />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function ComprehensionChart({ weeks }: { weeks: WeekStats[] }) {
  if (weeks.every((w) => w.comprehension === null)) {
    return <p className="empty">Rate your understanding when you log sessions to see this trend.</p>;
  }
  return (
    <TrendPlot
      weeks={weeks}
      value={(w) => w.comprehension}
      min={1}
      max={5}
      left={74}
      ticks={COMPREHENSION_LABELS.map((label, i) => ({ value: i + 1, label }))}
      label="Average self-rated comprehension per week. Values are in the table below."
      describe={(rating) => `${rating.toFixed(1)} of 5`}
    />
  );
}

export function KnownWordsChart({ weeks }: { weeks: WeekStats[] }) {
  if (weeks.every((w) => w.knownPercent === null)) {
    return <p className="empty">Send a session to the log from the Watch page to see this trend.</p>;
  }
  return (
    <TrendPlot
      weeks={weeks}
      value={(w) => w.knownPercent}
      min={0}
      max={100}
      left={PLOT.left + 6}
      ticks={[0, 25, 50, 75, 100].map((value) => ({ value, label: `${value}%` }))}
      label="Percent of the vocabulary heard that was known, per week. Values are in the table below."
      describe={(known) => `${Math.round(known)}% of words known`}
    />
  );
}

function TrendPlot({ weeks, value, min, max, left, ticks, label, describe }: {
  weeks: WeekStats[];
  value: (week: WeekStats) => number | null;
  min: number;
  max: number;
  left: number;
  ticks: { value: number; label: string }[];
  label: string;
  describe: (value: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 200;
  const plotW = width - left - PLOT.right;
  const plotH = height - PLOT.top - PLOT.bottom;
  const band = plotW / weeks.length;
  const x = (i: number) => left + band * (i + 0.5);
  const y = (v: number) => PLOT.top + plotH - ((v - min) / (max - min)) * plotH;
  const stride = labelStride(band);

  // Empty weeks break the line rather than implying a trend across the gap.
  const runs: string[] = [];
  let run: string[] = [];
  weeks.forEach((week, i) => {
    const v = value(week);
    if (v === null) {
      if (run.length > 1) runs.push(run.join(" "));
      run = [];
    } else {
      run.push(`${x(i)},${y(v)}`);
    }
  });
  if (run.length > 1) runs.push(run.join(" "));

  const lastRated = weeks.reduce((last, w, i) => (value(w) !== null ? i : last), -1);

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          {ticks.map((tick) => (
            <g key={tick.label}>
              <line className="grid" x1={left} x2={width - PLOT.right} y1={y(tick.value)} y2={y(tick.value)} />
              <text className="tick" x={left - 6} y={y(tick.value) + 4} textAnchor="end">{tick.label}</text>
            </g>
          ))}
          {runs.map((points) => <polyline key={points} className="line" points={points} />)}
          {weeks.map((week, i) => {
            const showLabel = (weeks.length - 1 - i) % stride === 0;
            const rating = value(week);
            const text = `Week of ${shortDate(week.start)}: ${rating === null ? "no data" : describe(rating)}`;
            return (
              <g key={week.start.getTime()}>
                {showLabel && (
                  <text className="tick" x={x(i)} y={height - 6} textAnchor="middle">{shortDate(week.start)}</text>
                )}
                {rating !== null && (
                  <>
                    <circle className="dot" cx={x(i)} cy={y(rating)} r={i === lastRated ? 5 : 4} />
                    <rect
                      className="hit"
                      x={left + band * i}
                      y={PLOT.top}
                      width={band}
                      height={plotH}
                      tabIndex={0}
                      aria-label={text}
                      data-tip={text}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

const HEAT_THRESHOLDS = [1, 30, 60, 120];

function heatLevel(minutes: number): number {
  return HEAT_THRESHOLDS.filter((t) => minutes >= t).length;
}

export function Heatmap({ sessions, today }: { sessions: Session[]; today: Date }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const left = 30;
  const top = 18;
  const columns = Math.min(53, Math.max(8, Math.floor((width - left) / 15)));
  const step = Math.min(18, (width - left) / columns);
  const cell = step - 2;
  const days = minutesByDay(sessions);
  const firstWeek = addDays(startOfWeek(today), -(columns - 1) * 7);
  const todayKey = toKey(today);

  const cells = [];
  const months = [];
  let lastMonthColumn = -3;
  let lastMonth = -1;
  for (let c = 0; c < columns; c++) {
    const monday = addDays(firstWeek, c * 7);
    if (monday.getMonth() !== lastMonth) {
      lastMonth = monday.getMonth();
      if (c - lastMonthColumn >= 3) {
        months.push(
          <text key={c} className="tick" x={left + c * step} y={11}>
            {monday.toLocaleDateString(undefined, { month: "short" })}
          </text>,
        );
        lastMonthColumn = c;
      }
    }
    for (let r = 0; r < 7; r++) {
      const date = addDays(monday, r);
      const key = toKey(date);
      if (key > todayKey) continue;
      const minutes = days.get(key) ?? 0;
      cells.push(
        <rect
          key={key}
          className={`heat heat-${heatLevel(minutes)}`}
          x={left + c * step}
          y={top + r * step}
          width={cell}
          height={cell}
          rx={2}
          data-tip={`${longDate(fromKey(key))}: ${minutes > 0 ? formatMinutes(minutes) : "nothing logged"}`}
        />,
      );
    }
  }

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg
          width={width}
          height={top + step * 7}
          role="img"
          aria-label="Minutes immersed per day. Every session is listed in the history table."
        >
          {months}
          {["Mon", "Wed", "Fri"].map((day, i) => (
            <text key={day} className="tick" x={0} y={top + (i * 2 + 1) * step - 3 - step + cell}>
              {day}
            </text>
          ))}
          {cells}
        </svg>
      )}
      <div className="heat-legend">
        <span>None</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <svg key={level} width={12} height={12} aria-hidden="true">
            <rect className={`heat heat-${level}`} width={12} height={12} rx={2} />
          </svg>
        ))}
        <span>2h+</span>
      </div>
    </div>
  );
}

export function RankedBars({ rows, empty }: { rows: { name: string; minutes: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  const max = rows[0]!.minutes;
  return (
    <ul className="ranked">
      {rows.map((row) => (
        <li key={row.name}>
          <span className="ranked-name" title={row.name}>{row.name}</span>
          <span className="ranked-track">
            <span className="ranked-bar" style={{ width: `${(row.minutes / max) * 100}%` }} />
          </span>
          <span className="ranked-value">{formatMinutes(row.minutes)}</span>
        </li>
      ))}
    </ul>
  );
}
