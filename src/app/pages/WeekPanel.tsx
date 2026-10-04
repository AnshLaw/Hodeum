import type { SkillRecord } from "../../lib/types";
import type { HodeRecord } from "../../data/types";
import { computeStats, weekActivity, type DayActivity } from "../../data/stats";

/** The tallest step is this share of the chart, so even a big day leaves room for its label. */
const TALLEST_STEP = 0.86;
/** A day with any practice is at least this tall: a short Hode still shows as a step, not a hairline. */
const SHORTEST_STEP = 0.1;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The week in a sentence a learner would say about it, rather than a row of numbers. */
export function weekSentence(week: DayActivity[], streak: number, mastered: number): string {
  const minutes = week.reduce((sum, d) => sum + d.minutes, 0);
  const hodes = week.reduce((sum, d) => sum + d.hodes, 0);
  const completed = week.reduce((sum, d) => sum + d.completed, 0);
  if (hodes === 0) return "No Hodes this week yet. Pick one below and Hodey will walk you through it.";
  const time = minutes < 1 ? "a few moments" : plural(minutes, "minute");
  const parts = [`This week you spent ${time} in ${plural(hodes, "Hode")}`];
  parts.push(completed > 0 ? `and finished ${completed}` : "and haven't finished one yet");
  const tail = [streak > 1 ? `You're on a ${streak}-day streak` : undefined, mastered > 0 ? `${plural(mastered, "skill")} mastered so far` : undefined].filter(Boolean);
  return `${parts.join(" ")}.${tail.length > 0 ? ` ${tail.join(", ")}.` : ""}`;
}

function stepHeight(day: DayActivity, most: number): number {
  if (day.hodes === 0) return 0;
  return Math.max(SHORTEST_STEP, (day.minutes / Math.max(most, 1)) * TALLEST_STEP);
}

const dayName = (date: Date) => date.toLocaleDateString(undefined, { weekday: "short" });

function dayTitle(day: DayActivity): string {
  const when = day.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return day.hodes === 0 ? `${when}: no Hodes` : `${when}: ${plural(day.minutes, "minute")}, ${plural(day.hodes, "Hode")}, ${day.completed} finished`;
}

/** Hodeum's mark climbs like stairs; the week does too: one step per day, as tall as the time spent. */
function WeekSteps({ week }: { week: DayActivity[] }) {
  const most = Math.max(...week.map((d) => d.minutes));
  return (
    <ol className="hweek__steps" aria-label="Minutes learning each day this week">
      {week.map((day) => (
        <li key={day.date.toISOString()} className="hweek__day" data-today={day.today || undefined} data-empty={day.hodes === 0 || undefined} title={dayTitle(day)}>
          <span className="hweek__col">
            {day.hodes > 0 && <span className="hweek__minutes">{day.minutes}m</span>}
            <span className="hweek__step" style={{ blockSize: `${stepHeight(day, most) * 100}%` }} />
          </span>
          <span className="hweek__name">{day.today ? "Today" : dayName(day.date)}</span>
        </li>
      ))}
    </ol>
  );
}

export function WeekPanel({ hodes, skills, now }: { hodes: HodeRecord[]; skills: SkillRecord[]; now: Date }) {
  const stats = computeStats(hodes, skills, now);
  const week = weekActivity(hodes, now);
  return (
    <section className="hcard hweek" aria-label="Your week">
      <div className="hweek__text">
        <h2>Your week</h2>
        <p className="hweek__sentence">{weekSentence(week, stats.streakDays, stats.skillsMastered)}</p>
        <dl className="hweek__totals">
          <div>
            <dt>Finished</dt>
            <dd>{stats.hodesCompleted}</dd>
          </div>
          <div>
            <dt>Skills mastered</dt>
            <dd>{stats.skillsMastered}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{plural(stats.streakDays, "day")}</dd>
          </div>
          <div>
            <dt>All time</dt>
            <dd>{plural(stats.minutesLearning, "min", "min")}</dd>
          </div>
        </dl>
      </div>
      <WeekSteps week={week} />
    </section>
  );
}
