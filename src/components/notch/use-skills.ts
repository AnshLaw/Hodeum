import { useEffect, useMemo, useState } from "react";
import type { Bus } from "../../lib/bus";
import type { SkillRecord, TaskPack } from "../../lib/types";
import type { HodePhase, HodeState } from "../../features/hode/model";
import { buildSkillGraph, masteryChanges, nextUp, type MasteryChange, type NextUp, type SkillGraph } from "../../features/skills/graph";

/** The notch's read of the learner's skills: the same local store the runtime writes to. */
export interface SkillSource {
  listSkills(): Promise<SkillRecord[]>;
}

export type SkillRecords = { state: "loading" } | { state: "ready"; records: SkillRecord[] } | { state: "error"; message: string };

export interface SuccessProgress {
  changes: MasteryChange[];
  next?: NextUp;
}

/** Everything the notch needs to show skills: the graph view, and the success card's progress. */
export interface NotchSkills {
  open: boolean;
  setOpen: (open: boolean) => void;
  graph: { state: "loading" } | { state: "ready"; graph: SkillGraph } | { state: "error"; message: string };
  progress?: SuccessProgress;
  onPractise: (next: NextUp) => void;
}

const NOT_RUNNING: HodePhase[] = ["idle", "goal_entry"];
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The learner's skill records, reloaded whenever local data changes (a step's progress was saved). */
export function useSkillRecords(source: SkillSource | undefined, bus: Bus): SkillRecords {
  const [records, setRecords] = useState<SkillRecords>({ state: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => bus.on("data:changed", () => setVersion((v) => v + 1)), [bus]);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    source.listSkills().then(
      (list) => alive && setRecords({ state: "ready", records: list }),
      (error) => {
        console.error("Couldn't load your skills", error);
        if (alive) setRecords({ state: "error", message: messageOf(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [source, version]);
  return records;
}

/**
 * Skill records as they were when the running Hode started, so the success card can show what moved.
 * Read while nothing has been learned yet: a back-to-back Hode (Start a Hode from the success card)
 * resets the learned list even when the phase never passes through idle.
 */
export function useHodeStartSkills(source: SkillSource | undefined, state: Pick<HodeState, "phase" | "learnedSkills">): SkillRecord[] | undefined {
  const [before, setBefore] = useState<SkillRecord[]>();
  const fresh = !NOT_RUNNING.includes(state.phase) && state.learnedSkills.length === 0;
  const idle = state.phase === "idle";
  useEffect(() => {
    if (idle) setBefore(undefined);
    if (!fresh || !source) return;
    let alive = true;
    // The first progress write waits for the learner to finish a step, so this read comes first.
    source.listSkills().then(
      (list) => alive && setBefore(list),
      (error) => console.error("Couldn't read skills at the start of the Hode", error),
    );
    return () => {
      alive = false;
    };
  }, [fresh, idle, source]);
  return before;
}

/** What moved in this Hode and what to practise next, once the success card is up. */
export function successProgress(state: HodeState, before: SkillRecord[] | undefined, records: SkillRecords, packs: TaskPack[]): SuccessProgress | undefined {
  if (state.phase !== "success" || records.state !== "ready") return undefined;
  // Without a snapshot, show where each skill stands now rather than inventing a change.
  const changes = masteryChanges(state.learnedSkills, before ?? records.records, records.records);
  return { changes, next: nextUp(packs, records.records, state.pack?.id) };
}

export function graphOf(records: SkillRecords, packs: TaskPack[]): NotchSkills["graph"] {
  if (records.state !== "ready") return records;
  return { state: "ready", graph: buildSkillGraph(records.records, packs) };
}

/** The notch's skills, or undefined where there's no skill store to read (the menu then hides "Your skills"). */
export function useNotchSkills(source: SkillSource | undefined, bus: Bus, state: HodeState, packs: TaskPack[], start: (next: NextUp) => void): NotchSkills | undefined {
  const [open, setOpen] = useState(false);
  const records = useSkillRecords(source, bus);
  const before = useHodeStartSkills(source, state);
  const graph = useMemo(() => graphOf(records, packs), [records, packs]);
  if (!source) return undefined;
  const onPractise = (next: NextUp) => {
    setOpen(false);
    start(next);
  };
  return { open, setOpen, graph, progress: successProgress(state, before, records, packs), onPractise };
}
