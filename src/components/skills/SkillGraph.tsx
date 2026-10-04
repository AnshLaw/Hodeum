import type { SkillArea, SkillGraph } from "../../features/skills/graph";
import "./skill-graph.css";

const RING_SIZE = 18;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A small donut filled to `value` (0–1); `from` shows earlier progress as a fainter arc underneath. */
export function MasteryRing({ value, from }: { value: number; from?: number }) {
  const centre = RING_SIZE / 2;
  const arc = (fraction: number) => `${fraction * RING_LENGTH} ${RING_LENGTH}`;
  return (
    <svg className="mastery-ring" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
      <circle className="mastery-ring__track" cx={centre} cy={centre} r={RING_RADIUS} strokeWidth={RING_STROKE} />
      <circle className="mastery-ring__fill" cx={centre} cy={centre} r={RING_RADIUS} strokeWidth={RING_STROKE} strokeDasharray={arc(value)} />
      {from !== undefined && from > 0 && <circle className="mastery-ring__before" cx={centre} cy={centre} r={RING_RADIUS} strokeWidth={RING_STROKE} strokeDasharray={arc(Math.min(from, value))} />}
    </svg>
  );
}

/** One area as a chain of skill chips; a link joins a skill to the prerequisite just before it. */
export function SkillAreaGraph({ area, heading = true }: { area: SkillArea; heading?: boolean }) {
  return (
    <section className="skill-graph__area" aria-label={area.title}>
      {heading && (
        <header className="skill-graph__head">
          <span className="skill-graph__title">{area.title}</span>
          <span className="skill-graph__count">{masteredCount(area)}</span>
        </header>
      )}
      <ol className="skill-graph__nodes">
        {area.nodes.map((node) => (
          <li key={node.id} className="skill-node" data-mastery={node.masteryLabel.toLowerCase()} data-linked={node.linked || undefined} title={`${node.label}: ${node.masteryLabel}`} aria-label={`${node.label}: ${node.masteryLabel}`}>
            <MasteryRing value={node.mastery} />
            <span className="skill-node__label">{node.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function masteredCount(area: SkillArea): string {
  return `${area.mastered} of ${area.nodes.length} mastered`;
}

/** The Hodian skill graph: areas of linked skills with their mastery. Shared by the notch and the app. */
export function SkillGraphView({ graph }: { graph: SkillGraph }) {
  return (
    <div className="skill-graph">
      {graph.areas.map((area) => (
        <SkillAreaGraph key={area.id} area={area} />
      ))}
    </div>
  );
}
