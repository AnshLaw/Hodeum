import { masteryOf } from "../../data/stats";
import type { SkillRecord, TaskPack } from "../../lib/types";

/**
 * The Hodian skill graph (PRD §6) as one pure view model, shared by the notch and the app window so
 * both show the same areas, links and mastery.
 */
export type MasteryLabel = "New" | "Learning" | "Mastered";

export interface SkillEdge {
  /** The prerequisite: taught earlier in a Hode. */
  from: string;
  to: string;
}

export interface SkillNode {
  id: string;
  /** "Pivot · Create": the area is shown by the group. */
  label: string;
  /** 0–1 toward mastery. */
  mastery: number;
  masteryLabel: MasteryLabel;
  record?: SkillRecord;
  /** The node before this one in its area is one of its prerequisites. */
  linked: boolean;
}

export interface SkillArea {
  /** The skill id prefix: "excel", "windows", "ios", … */
  id: string;
  title: string;
  nodes: SkillNode[];
  mastered: number;
}

export interface SkillGraph {
  areas: SkillArea[];
  edges: SkillEdge[];
}

export const AREA_TITLES: Record<string, string> = { excel: "Excel", windows: "Windows", ios: "iPhone", general: "Anything else" };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function skillArea(skillId: string): string {
  return skillId.split(".")[0];
}

export function areaTitle(area: string): string {
  return AREA_TITLES[area] ?? capitalise(area);
}

/** "excel.pivot.create" -> "Pivot · Create" */
export function skillName(skillId: string): string {
  const [, ...parts] = skillId.split(".");
  return parts.map((part) => capitalise(part.replace(/_/g, " "))).join(" · ");
}

export function masteryLabel(record: SkillRecord | undefined): MasteryLabel {
  if (!record) return "New";
  return record.status === "mastered" ? "Mastered" : "Learning";
}

export function skillMastery(record: SkillRecord | undefined): number {
  return record ? masteryOf(record) : 0;
}

/** Each pack step's skill is a prerequisite of the next distinct skill in that pack. */
export function prerequisiteEdges(packs: TaskPack[]): SkillEdge[] {
  const seen = new Set<string>();
  const edges: SkillEdge[] = [];
  for (const pack of packs) {
    const skills = pack.steps.map((step) => step.skill).filter((skill, i, all) => skill !== all[i - 1]);
    for (let i = 1; i < skills.length; i++) {
      const key = `${skills[i - 1]}>${skills[i]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: skills[i - 1], to: skills[i] });
    }
  }
  return edges;
}

/** Prerequisites before the skills they unlock; ties (and any cycle) keep first-seen order. */
export function orderSkills(ids: string[], edges: SkillEdge[]): string[] {
  const pending = new Set(ids);
  const blockers = (id: string) => edges.filter((e) => e.to === id && e.from !== id && pending.has(e.from)).length;
  const ordered: string[] = [];
  while (pending.size > 0) {
    const ready = ids.find((id) => pending.has(id) && blockers(id) === 0) ?? ids.find((id) => pending.has(id));
    if (ready === undefined) break;
    ordered.push(ready);
    pending.delete(ready);
  }
  return ordered;
}

/** Every skill a pack teaches or the learner practised, in first-seen order. */
function knownSkills(skills: SkillRecord[], packs: TaskPack[]): string[] {
  const ids = [...packs.flatMap((pack) => pack.steps.map((step) => step.skill)), ...skills.map((s) => s.skill_id)];
  return [...new Set(ids)];
}

function areaOf(id: string, ids: string[], edges: SkillEdge[], records: Map<string, SkillRecord>): SkillArea {
  const ordered = orderSkills(ids, edges);
  const nodes = ordered.map((skillId, i) => {
    const record = records.get(skillId);
    const linked = i > 0 && edges.some((e) => e.from === ordered[i - 1] && e.to === skillId);
    return { id: skillId, label: skillName(skillId), mastery: skillMastery(record), masteryLabel: masteryLabel(record), record, linked };
  });
  return { id, title: areaTitle(id), nodes, mastered: nodes.filter((n) => n.masteryLabel === "Mastered").length };
}

/** Areas the learner has practised most come first; the rest keep pack order. */
export function buildSkillGraph(skills: SkillRecord[], packs: TaskPack[]): SkillGraph {
  const edges = prerequisiteEdges(packs);
  const records = new Map(skills.map((s) => [s.skill_id, s]));
  const byArea = new Map<string, string[]>();
  for (const id of knownSkills(skills, packs)) byArea.set(skillArea(id), [...(byArea.get(skillArea(id)) ?? []), id]);
  const areas = [...byArea].map(([id, ids]) => areaOf(id, ids, edges, records));
  return { areas: mostPractisedFirst(areas), edges };
}

function mostPractisedFirst(areas: SkillArea[]): SkillArea[] {
  const practised = (area: SkillArea) => area.nodes.filter((n) => n.record).length;
  // Array.prototype.sort is stable, so equally practised areas keep pack order.
  return [...areas].sort((a, b) => practised(b) - practised(a));
}

export interface MasteryChange {
  id: string;
  label: string;
  from: number;
  to: number;
  fromLabel: MasteryLabel;
  toLabel: MasteryLabel;
  newlyMastered: boolean;
}

/** How each skill practised in a Hode moved; a skill whose new record isn't saved yet holds steady. */
export function masteryChanges(practised: string[], before: SkillRecord[], after: SkillRecord[]): MasteryChange[] {
  const find = (list: SkillRecord[], id: string) => list.find((s) => s.skill_id === id);
  return practised.map((id) => {
    const previous = find(before, id);
    const next = find(after, id) ?? previous;
    const fromLabel = masteryLabel(previous);
    const toLabel = masteryLabel(next);
    return { id, label: skillName(id), from: skillMastery(previous), to: skillMastery(next), fromLabel, toLabel, newlyMastered: toLabel === "Mastered" && fromLabel !== "Mastered" };
  });
}

/** "New → Learning", "Learning ↑" (less help needed now), or just where it stands. */
export function changeText(change: MasteryChange): string {
  if (change.fromLabel !== change.toLabel) return `${change.fromLabel} → ${change.toLabel}`;
  return change.to > change.from ? `${change.toLabel} ↑` : change.toLabel;
}

/** Packs worth practising next: never tried first, then the least mastered. */
export function suggestedPacks(packs: TaskPack[], skills: SkillRecord[]): TaskPack[] {
  const bySkill = new Map(skills.map((s) => [s.skill_id, s]));
  const score = (pack: TaskPack) => {
    const records = pack.steps.map((step) => bySkill.get(step.skill));
    if (records.every((r) => r === undefined)) return -1;
    return records.filter((r) => r?.status === "mastered").length / pack.steps.length;
  };
  return [...packs].filter((pack) => score(pack) < 1).sort((a, b) => score(a) - score(b));
}

export interface NextUp {
  skillId: string;
  label: string;
  pack: TaskPack;
}

const packArea = (pack: TaskPack) => (pack.steps[0] ? skillArea(pack.steps[0].skill) : "");

/** What to practise after `finishedPackId`: another Hode in the same area, then any other, then this one again. */
export function nextUp(packs: TaskPack[], skills: SkillRecord[], finishedPackId: string | undefined): NextUp | undefined {
  const finished = packs.find((p) => p.id === finishedPackId);
  const rank = (pack: TaskPack) => (pack.id === finishedPackId ? 2 : finished && packArea(pack) === packArea(finished) ? 0 : 1);
  const candidates = suggestedPacks(packs, skills)
    .map((pack, i) => ({ pack, i }))
    .sort((a, b) => rank(a.pack) - rank(b.pack) || a.i - b.i);
  const pack = candidates[0]?.pack;
  if (!pack) return undefined;
  const mastered = new Set(skills.filter((s) => s.status === "mastered").map((s) => s.skill_id));
  const step = pack.steps.find((s) => !mastered.has(s.skill)) ?? pack.steps[0];
  return { skillId: step.skill, label: skillName(step.skill), pack };
}
