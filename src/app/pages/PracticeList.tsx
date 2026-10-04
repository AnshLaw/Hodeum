import type { TaskPack } from "../../lib/types";
import type { AppServices } from "../services";

/** Guided Hodes with a one-click Start; disabled while another Hode is running. */
export function PracticeList({ packs, services, busy }: { packs: TaskPack[]; services: AppServices; busy?: boolean }) {
  return (
    <ul className="hlist">
      {packs.map((pack) => (
        <li key={pack.id} className="hlist__row">
          <span className="hlist__main">
            <strong>{pack.title}</strong>
            <span className="hmuted">
              {pack.app} · {pack.steps.length} steps
            </span>
          </span>
          <button type="button" className="btn btn--small" onClick={() => services.bus.emit("hode:start", { goal: pack.title })} disabled={busy}>
            Start
          </button>
        </li>
      ))}
    </ul>
  );
}
