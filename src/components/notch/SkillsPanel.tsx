import { COPY } from "../../lib/copy";
import { changeText, type MasteryChange } from "../../features/skills/graph";
import { MasteryRing, SkillGraphView } from "../skills/SkillGraph";
import type { SurfaceProps } from "./surface";
import type { NotchSkills, SuccessProgress } from "./use-skills";

/** "Your skills", opened from Hodey's menu: every area as a small graph of linked skills. */
export function SkillsPanel({ skills }: { skills: NotchSkills }) {
  const { graph } = skills;
  return (
    <div className="notch__content skills-panel">
      {graph.state === "loading" && <p className="notch__detail">{COPY.skillsLoading}</p>}
      {graph.state === "error" && (
        <p className="notch__detail" role="alert">
          {COPY.skillsFailed}: {graph.message}
        </p>
      )}
      {graph.state === "ready" && (
        <div className="skills-panel__scroll">
          <SkillGraphView graph={graph.graph} />
        </div>
      )}
      <div className="notch__actions">
        <span className="dock-menu__hint">{COPY.skillsHint}</span>
        <span className="notch__spacer" />
        <button type="button" className="btn btn--neutral" onClick={() => skills.setOpen(false)}>
          {COPY.back}
        </button>
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: MasteryChange }) {
  return (
    <li className="skill-change" data-mastery={change.toLabel.toLowerCase()}>
      <MasteryRing value={change.to} from={change.from} />
      <span className="skill-change__label">{change.label}</span>
      <span className="skill-change__status">{change.newlyMastered ? COPY.skillLearned : changeText(change)}</span>
    </li>
  );
}

/** The success card's skill graph: what this Hode moved, and what to practise next. */
export function SuccessSkills({ progress, onPractise }: { progress: SuccessProgress; onPractise: NotchSkills["onPractise"] }) {
  const { changes, next } = progress;
  return (
    <div className="success-skills">
      {changes.length > 0 && (
        <ul className="success-skills__changes">
          {changes.map((change) => (
            <ChangeRow key={change.id} change={change} />
          ))}
        </ul>
      )}
      {next && (
        <div className="success-skills__next">
          <span className="success-skills__next-text">
            <span className="dock-menu__label">{COPY.nextUp}</span>
            <span>
              {next.label} · {next.pack.title}
            </span>
          </span>
          <button type="button" className="btn btn--primary btn--small" onClick={() => onPractise(next)}>
            {COPY.startHode}
          </button>
        </div>
      )}
    </div>
  );
}

/** The success card's skill section, when there's progress to show; otherwise the plain chips stay. */
export function successExtra({ view, skills }: Pick<SurfaceProps, "view" | "skills">) {
  if (view.mode !== "success" || !skills?.progress) return undefined;
  return <SuccessSkills progress={skills.progress} onPractise={skills.onPractise} />;
}
