import { useState } from "react";
import type { HodeSummary } from "../../lib/bus";
import type { SkillRecord } from "../../lib/types";
import type { HodeRecord } from "../../data/types";
import { useLiveQuery } from "../hooks";
import type { Page } from "../App";
import type { AppServices } from "../services";
import { durationLabel, greeting, outcomeOf, suggestedPacks, timeAgo } from "../view";
import { PracticeList } from "./PracticeList";
import { WeekPanel } from "./WeekPanel";
import { ACCOUNT_COPY } from "../../features/account/copy";
import type { AccountStatus } from "../../features/account/types";
import "./pages.css";

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
      <button type="button" className="btn btn--neutral" onClick={() => services.bus.emit("hode:end", {})}>
        End Hode
      </button>
    </section>
  );
}

/** Signed out (and accounts set up): one clear invitation to sync, on the page the learner sees first. */
function SignInCard({ account, services }: { account?: AccountStatus; services: AppServices }) {
  if (!account?.configured || account.phase === "signed-in") return null;
  const waiting = account.phase === "signing-in";
  return (
    <section className="hcard hsignin" aria-label={ACCOUNT_COPY.signInLabel}>
      <div className="hsignin__text">
        <h2>{ACCOUNT_COPY.homeSignInTitle}</h2>
        <p className="hmuted">{waiting ? ACCOUNT_COPY.waiting : ACCOUNT_COPY.homeSignInDetail}</p>
      </div>
      {waiting ? (
        <button type="button" className="btn" onClick={() => services.bus.emit("account:cancel", {})}>
          Cancel
        </button>
      ) : (
        <button type="button" className="btn btn--primary" onClick={() => services.bus.emit("account:sign-in", {})}>
          {ACCOUNT_COPY.signInLabel}
        </button>
      )}
    </section>
  );
}

/** First name from the Google account, or the product's name for the learner. */
function learnerName(account?: AccountStatus): string {
  const name = account?.phase === "signed-in" ? account.user?.name?.trim().split(/\s+/)[0] : undefined;
  return name || "Hodian";
}

/** First run: no history yet, so show how a Hode works instead of a row of zeros. */
function HowItWorks() {
  return (
    <section className="hcard">
      <h2>How a Hode works</h2>
      <ol className="hhow">
        <li>
          <strong>Say what you want to learn</strong>
          <span className="hmuted">Type it above, pick a guided Hode, or hold Right Ctrl and tell Hodey.</span>
        </li>
        <li>
          <strong>Hodey points, you click</strong>
          <span className="hmuted">It highlights the next control in the real app and explains why.</span>
        </li>
        <li>
          <strong>Hodey checks your work</strong>
          <span className="hmuted">Slips get a quick fix, and you get less help each time you repeat a skill.</span>
        </li>
      </ol>
    </section>
  );
}

function RecentHodes({ hodes, now, onNavigate }: { hodes: HodeRecord[]; now: Date; onNavigate: (page: Page) => void }) {
  return (
    <section className="hcard">
      <div className="hcard__head">
        <h2>Recent Hodes</h2>
        <button type="button" className="hlink" onClick={() => onNavigate("hodes")}>
          See all
        </button>
      </div>
      <ul className="hlist">
        {hodes.slice(0, RECENT_COUNT).map((hode) => {
          const outcome = outcomeOf(hode, now);
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
  );
}

function PracticeNext({ services, skills, live, onNavigate }: { services: AppServices; skills: SkillRecord[]; live?: HodeSummary; onNavigate: (page: Page) => void }) {
  const suggestions = suggestedPacks(services.packs, skills);
  return (
    <section className="hcard">
      <div className="hcard__head">
        <h2>Practice next</h2>
        <button type="button" className="hlink" onClick={() => onNavigate("learning")}>
          Learning paths
        </button>
      </div>
      {suggestions.length === 0 && <p className="hmuted">You've mastered every guided Hode. Ask Hodey for anything else.</p>}
      <PracticeList packs={suggestions} services={services} busy={live !== undefined} />
    </section>
  );
}

export function HomePage({ services, live, account, onNavigate }: { services: AppServices; live?: HodeSummary; account?: AccountStatus; onNavigate: (page: Page) => void }) {
  const [data] = useLiveQuery(services.bus, async () => ({ hodes: await services.learning.listHodes(HISTORY_FOR_STATS), skills: await services.learning.listSkills() }), []);
  const now = new Date();
  if (data.state !== "ready") return <p className="hmuted">{data.state === "error" ? `Couldn't load your learning: ${data.message}` : "Loading…"}</p>;
  const { hodes, skills } = data.value;
  const firstRun = hodes.length === 0;
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>
          {greeting(now)}, {learnerName(account)}
        </h1>
        <p className="hmuted">{firstRun ? "Learn something new in the apps you already use. Hodey guides, you do the clicking." : "Start a Hode, or pick up where you left off."}</p>
      </header>
      {live ? <LiveHode live={live} services={services} /> : <StartHode services={services} />}
      <SignInCard account={account} services={services} />
      {!firstRun && <WeekPanel hodes={hodes} skills={skills} now={now} />}
      <div className="hcolumns">
        {firstRun ? <HowItWorks /> : <RecentHodes hodes={hodes} now={now} onNavigate={onNavigate} />}
        <PracticeNext services={services} skills={skills} live={live} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
