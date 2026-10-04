import { ASSISTANCE_LEVELS, type AssistanceLevel, type SkillRecord } from "../../lib/types";
import { buildSkillGraph, masteryLabel, type SkillArea } from "../../features/skills/graph";
import { SkillAreaGraph, masteredCount } from "../../components/skills/SkillGraph";
import { useLiveQuery } from "../hooks";
import type { AppServices } from "../services";
import { LEVEL_LABELS, skillTitle, suggestedPacks } from "../view";

function Ladder({ level }: { level: AssistanceLevel }) {
  const reached = ASSISTANCE_LEVELS.indexOf(level);
  return (
    <span className="hladder" role="img" aria-label={`Hodey's help: ${LEVEL_LABELS[level]}`}>
      {ASSISTANCE_LEVELS.map((step, index) => (
        <i key={step} data-on={index <= reached || undefined} />
      ))}
    </span>
  );
}

function SkillRow({ skill, services }: { skill: SkillRecord; services: AppServices }) {
  const changed = () => services.bus.emit("data:changed", {});
  const setLevel = (level: AssistanceLevel) => {
    services.learning.setSkillLevel(skill.skill_id, level).then(changed, (error) => console.error("Couldn't change the help level", error));
  };
  const reset = () => {
    services.learning.resetSkill(skill.skill_id).then(changed, (error) => console.error("Couldn't reset the skill", error));
  };
  return (
    <li className="hskill">
      <span className="hskill__name">
        <strong>{skillTitle(skill.skill_id)}</strong>
        <span className="hmuted">
          {masteryLabel(skill)} · {skill.success_count} done · {skill.failure_count} slips
        </span>
      </span>
      <Ladder level={skill.last_assistance_level} />
      <label className="hskill__select">
        <span className="sr-only">Hodey's help for {skillTitle(skill.skill_id)}</span>
        <select className="field" value={skill.last_assistance_level} onChange={(e) => setLevel(e.target.value as AssistanceLevel)}>
          {ASSISTANCE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="hlink" onClick={reset}>
        Reset
      </button>
    </li>
  );
}

/** One area: the same linked-skill graph the notch shows, then a row per practised skill. */
function AreaCard({ area, services }: { area: SkillArea; services: AppServices }) {
  const practised = area.nodes.flatMap((node) => (node.record ? [node.record] : []));
  return (
    <section className="hcard">
      <div className="hcard__head">
        <h2>{area.title}</h2>
        <span className="hmuted">{masteredCount(area)}</span>
      </div>
      <SkillAreaGraph area={area} heading={false} />
      {practised.length === 0 ? (
        <p className="hmuted">Not practised yet. Start a Hode to begin this path.</p>
      ) : (
        <ul className="hskills">
          {practised.map((skill) => (
            <SkillRow key={skill.skill_id} skill={skill} services={services} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Suggestions({ services, skills }: { services: AppServices; skills: SkillRecord[] }) {
  const suggestions = suggestedPacks(services.packs, skills);
  if (suggestions.length === 0) return null;
  return (
    <section className="hpaths" aria-label="Guided Hodes to practise">
      {suggestions.map((pack) => (
        <article key={pack.id} className="hcard hpath">
          <p className="heyebrow">{pack.app}</p>
          <h2>{pack.title}</h2>
          <ol className="hpath__steps">
            {pack.steps.map((step) => (
              <li key={step.id}>{step.objective}</li>
            ))}
          </ol>
          <button type="button" className="btn btn--primary" onClick={() => services.bus.emit("hode:start", { goal: pack.title })}>
            Practise this
          </button>
        </article>
      ))}
    </section>
  );
}

export function LearningPage({ services }: { services: AppServices }) {
  const [skills] = useLiveQuery(services.bus, () => services.learning.listSkills(), []);
  if (skills.state !== "ready") return <p className="hmuted">{skills.state === "error" ? `Couldn't load your skills: ${skills.message}` : "Loading…"}</p>;
  const graph = buildSkillGraph(skills.value, services.packs);
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>Learning paths</h1>
        <p className="hmuted">Hodey gives less help as you master each skill. Linked skills build on the one before. Change how much help you get for any skill here.</p>
      </header>
      <Suggestions services={services} skills={skills.value} />
      {graph.areas.length === 0 ? (
        <section className="hcard hempty">
          <h2>No skills yet</h2>
          <p className="hmuted">Finish a step in any Hode and your learning path starts here.</p>
        </section>
      ) : (
        graph.areas.map((area) => <AreaCard key={area.id} area={area} services={services} />)
      )}
    </div>
  );
}
