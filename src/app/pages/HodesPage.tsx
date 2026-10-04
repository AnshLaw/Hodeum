import { useState } from "react";
import { useLiveQuery } from "../hooks";
import type { AppServices } from "../services";
import { EVENT_LABELS, durationLabel, outcomeOf, timeAgo } from "../view";
import { PracticeList } from "./PracticeList";
import "./pages.css";

const HISTORY_LIMIT = 200;

function HodeDetail({ services, id }: { services: AppServices; id: string }) {
  const [detail] = useLiveQuery(services.bus, () => services.learning.getHode(id), [id]);
  if (detail.state === "loading") return <p className="hmuted">Loading…</p>;
  if (detail.state === "error") return <p className="hmuted">Couldn't load this Hode: {detail.message}</p>;
  const hode = detail.value;
  if (!hode) return <p className="hmuted">This Hode no longer exists.</p>;
  const outcome = outcomeOf(hode);
  const now = new Date();
  return (
    <article className="hdetail">
      <p className="heyebrow">{hode.open ? "Planned by Hodey" : "Guided Hode"}</p>
      <h2>{hode.goal}</h2>
      <p className="hmuted">
        Started {timeAgo(hode.startedAt, now)} · {durationLabel(hode)} ·{" "}
        <span className="hchip" data-tone={outcome.tone}>
          {outcome.label}
        </span>
      </p>
      <ol className="htimeline">
        <li data-kind="start">
          <strong>Started</strong>
          <span className="hmuted">{new Date(hode.startedAt).toLocaleTimeString()}</span>
        </li>
        {hode.events.map((event, index) => (
          <li key={`${event.at}-${index}`} data-kind={event.kind}>
            <strong>{EVENT_LABELS[event.kind]}</strong>
            {event.detail && <span>{event.detail}</span>}
            <span className="hmuted">{new Date(event.at).toLocaleTimeString()}</span>
          </li>
        ))}
        {hode.endedAt && (
          <li data-kind={hode.outcome === "completed" ? "done" : "end"}>
            <strong>{hode.outcome === "completed" ? "Hode complete" : "Ended"}</strong>
            <span className="hmuted">{new Date(hode.endedAt).toLocaleTimeString()}</span>
          </li>
        )}
      </ol>
    </article>
  );
}

export function HodesPage({ services }: { services: AppServices }) {
  const [hodes] = useLiveQuery(services.bus, () => services.learning.listHodes(HISTORY_LIMIT), []);
  const [selected, setSelected] = useState<string>();
  const now = new Date();
  if (hodes.state !== "ready") return <p className="hmuted">{hodes.state === "error" ? `Couldn't load your Hodes: ${hodes.message}` : "Loading…"}</p>;
  const current = selected ?? hodes.value[0]?.id;
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>Your Hodes</h1>
        <p className="hmuted">Every learning journey, with the steps you took and where Hodey helped.</p>
      </header>
      {hodes.value.length === 0 ? (
        <section className="hcard hempty">
          <h2>No Hodes yet</h2>
          <p className="hmuted">Each Hode you start shows up here, with every step you took and where Hodey helped. Try a guided one:</p>
          <PracticeList packs={services.packs} services={services} />
        </section>
      ) : (
        <div className="hsplit">
          <ul className="hcard hlist hlist--select" aria-label="Hodes">
            {hodes.value.map((hode) => {
              const outcome = outcomeOf(hode);
              return (
                <li key={hode.id}>
                  <button type="button" className="hlist__row hlist__button" aria-current={hode.id === current ? "true" : undefined} onClick={() => setSelected(hode.id)}>
                    <span className="hlist__main">
                      <strong>{hode.goal}</strong>
                      <span className="hmuted">{timeAgo(hode.startedAt, now)}</span>
                    </span>
                    <span className="hchip" data-tone={outcome.tone}>
                      {outcome.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <section className="hcard">{current && <HodeDetail services={services} id={current} />}</section>
        </div>
      )}
    </div>
  );
}
