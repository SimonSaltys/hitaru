import { addDays, longDate, toKey } from "../lib/dates";
import {
  dailyPace,
  formatMinutes,
  minutesByDay,
  nextMilestone,
  streaks,
  totalMinutes,
  weeklyStats,
} from "../lib/stats";
import type { Session, Settings } from "../lib/types";

function Meter({ value, label }: { value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Summary(props: { sessions: Session[]; settings: Settings; today: Date }) {
  const { sessions, settings, today } = props;
  const hours = totalMinutes(sessions, settings.priorHours) / 60;
  const milestone = nextMilestone(hours);
  const pace = dailyPace(sessions, today);
  const streak = streaks(sessions, today);
  const todayMinutes = minutesByDay(sessions).get(toKey(today)) ?? 0;
  const weekMinutes = weeklyStats(sessions, today, 1)[0]?.minutes ?? 0;
  const goalMinutes = settings.weeklyGoalHours * 60;

  let projection: string | null = null;
  if (milestone && pace > 0) {
    const days = Math.ceil(((milestone.next - hours) * 60) / pace);
    if (days <= 365 * 5) {
      projection = `At your current pace of ${formatMinutes(pace)} a day, you'll get there around ${longDate(addDays(today, days))}.`;
    }
  }

  return (
    <section className="summary">
      <div className="panel hero">
        <h2>Total immersion</h2>
        <p className="hero-value">
          {hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          <span> hours</span>
        </p>
        {milestone && (
          <>
            <Meter
              value={(hours - milestone.previous) / (milestone.next - milestone.previous)}
              label={`Progress to ${milestone.next} hours`}
            />
            <p className="secondary">
              {formatMinutes((milestone.next - hours) * 60)} to go until {milestone.next.toLocaleString()} hours.
              {projection && ` ${projection}`}
            </p>
          </>
        )}
      </div>
      <div className="tiles">
        <div className="panel tile">
          <h2>Current streak</h2>
          <p className="tile-value">
            {streak.current} {streak.current === 1 ? "day" : "days"}
          </p>
          <p className="secondary">Longest {streak.longest}</p>
        </div>
        <div className="panel tile">
          <h2>Today</h2>
          <p className="tile-value">{formatMinutes(todayMinutes)}</p>
          <p className="secondary">
            {todayMinutes === 0 ? "Nothing logged yet" : "Logged so far"}
          </p>
        </div>
        <div className="panel tile tile-wide">
          <h2>This week</h2>
          <p className="tile-value">{formatMinutes(weekMinutes)}</p>
          <Meter
            value={goalMinutes > 0 ? weekMinutes / goalMinutes : 0}
            label="Progress to weekly goal"
          />
          <p className="secondary">of {settings.weeklyGoalHours}h goal</p>
        </div>
      </div>
    </section>
  );
}
