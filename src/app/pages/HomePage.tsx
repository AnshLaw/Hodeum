import { useState } from "react";
import type { HodeSummary } from "../../lib/bus";
import { computeStats } from "../../data/stats";
import { useLiveQuery } from "../hooks";
import type { Page } from "../App";
import type { AppServices } from "../services";
import { durationLabel, greeting, outcomeOf, suggestedPacks, timeAgo } from "../view";

const RECENT_COUNT = 5;
const HISTORY_FOR_STATS = 500;

function StartHode({ services }: { services: AppServices }) {
  const [goal, setGoal] = useState("");
  const start = (text: string) => {
    if (text.trim() === "") return;
    services.bus.emit("hode:start", { goal: text.trim() });
    setGoal("");
  };
  return (
    <form
      className="hcard hstart"
      onSubmit={(event) => {
        event.preventDefault();
        start(goal);
      }}
    >
      <label htmlFor="app-goal" className="hstart__label">
        What do you want to learn?
      </label>
      <div className="hstart__row">
        <input id="app-goal" className="field hstart__field" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. make a pivot table in Excel" autoComplete="off" />
        <button type="submit" className="btn btn--primary hstart__go" disabled={goal.trim() === ""}>
          Start a Hode
        </button>
      </div>
      <p className="hstart__hint">Hodey will guide you from the notch while you work in the app itself.</p>
    </form>
  );
}

function LiveHode({ live, services }: { live: HodeSummary; services: AppServices }) {
  return (
    <section className="hcard hlive" aria-label="Hode in progress">
      <span className="hlive__pulse" aria-hidden="true" />
      <div className="hlive__text">
        <p className="heyebrow">Continue your Hode{live.step ? ` · step ${live.step.current} of ${live.step.total}` : ""}</p>
        <h2>{live.goal}</h2>
        {live.title && <p className="hmuted">{live.title}</p>}
      </div>
      <button type="button" className="btn" onClick={() => services.bus.emit("hode:end", {})}>
        End Hode
      </button>
    </section>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="hstat">
      <span className="hstat__value">{value}</span>
      <span className="hstat__label">{label}</span>
    </div>
  );
}

export function HomePage({ services, live, onNavigate }: { services: AppServices; live?: HodeSummary; onNavigate: (page: Page) => void }) {
  const [data] = useLiveQuery(services.bus, async () => ({ hodes: await services.learning.listHodes(HISTORY_FOR_STATS), skills: await services.learning.listSkills() }), []);
  const now = new Date();
  if (data.state !== "ready") return <p className="hmuted">{data.state === "error" ? `Couldn't load your learning: ${data.message}` : "Loading…"}</p>;
  const { hodes, skills } = data.value;
  const stats = computeStats(hodes, skills, now);
  const suggestions = suggestedPacks(services.packs, skills);
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>{greeting(now)}, Hodian</h1>
        <p className="hmuted">Start a Hode, or pick up where you left off.</p>
      </header>
      {live ? <LiveHode live={live} services={services} /> : <StartHode services={services} />}
      <section className="hstats" aria-label="Your progress">
        <Stat value={stats.hodesCompleted} label="Hodes completed" />
        <Stat value={stats.skillsMastered} label="Skills mastered" />
        <Stat value={`${stats.streakDays} ${stats.streakDays === 1 ? "day" : "days"}`} label="Learning streak" />
        <Stat value={stats.minutesLearning} label="Minutes learning" />
      </section>
      <div className="hcolumns">
        <section className="hcard">
          <div className="hcard__head">
            <h2>Recent Hodes</h2>
            <button type="button" className="hlink" onClick={() => onNavigate("hodes")}>
              See all
            </button>
          </div>
          {hodes.length === 0 && <p className="hmuted">Your Hodes will appear here once you start one.</p>}
          <ul className="hlist">
            {hodes.slice(0, RECENT_COUNT).map((hode) => {
              const outcome = outcomeOf(hode);
              return (
                <li key={hode.id} className="hlist__row">
                  <span className="hlist__main">
                    <strong>{hode.goal}</strong>
                    <span className="hmuted">
                      {timeAgo(hode.startedAt, now)} · {durationLabel(hode)}
                    </span>
                  </span>
                  <span className="hchip" data-tone={outcome.tone}>
                    {outcome.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="hcard">
          <div className="hcard__head">
            <h2>Practice next</h2>
            <button type="button" className="hlink" onClick={() => onNavigate("learning")}>
              Learning paths
            </button>
          </div>
          {suggestions.length === 0 && <p className="hmuted">You've mastered every guided Hode. Ask Hodey for anything else.</p>}
          <ul className="hlist">
            {suggestions.map((pack) => (
              <li key={pack.id} className="hlist__row">
                <span className="hlist__main">
                  <strong>{pack.title}</strong>
                  <span className="hmuted">
                    {pack.app} · {pack.steps.length} steps
                  </span>
                </span>
                <button type="button" className="btn btn--small" onClick={() => services.bus.emit("hode:start", { goal: pack.title })} disabled={live !== undefined}>
                  Start
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
