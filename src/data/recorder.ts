import type { HodeEvent, HodeState } from "../features/hode/model";
import { currentStep } from "../features/hode/model";
import type { HodeEventRecord, HodeLog, HodeOutcome, HodeRecord } from "./types";

export type LogOp =
  | { op: "start"; hode: HodeRecord }
  | { op: "event"; event: HodeEventRecord }
  | { op: "end"; id: string; outcome: HodeOutcome; at: string };

const ACTIVE_PHASES = new Set(["observing", "reasoning", "guiding", "answering", "annotating", "paused", "recovering", "acting", "checkpoint"]);

function started(event: HodeEvent, prev: HodeState, next: HodeState): boolean {
  const fromGoal = event.type === "GOAL_SUBMITTED" && prev.phase === "goal_entry";
  // A practice round is a Hode of its own, started from the finished one.
  const practice = event.type === "PRACTICE_AGAIN" && prev.phase === "success";
  return (fromGoal || practice) && next.phase === "observing";
}

/**
 * The learner finished a step, by whatever event Hodey noticed it (a click, "I did it", the read that
 * prepared the next step). Hodey's own steps and skipped ones aren't the learner's.
 */
export function learnerFinishedStep(event: HodeEvent, prev: HodeState, next: HodeState): boolean {
  if (!prev.pack || event.type === "HODEY_ACTED" || event.type === "SKIP_STEP" || event.type === "PRACTICE_AGAIN") return false;
  return next.stepIndex > prev.stepIndex || (next.phase === "success" && prev.phase !== "success");
}

function progressEvents(event: HodeEvent, prev: HodeState, next: HodeState, at: string, hodeId: string): HodeEventRecord[] {
  const out: HodeEventRecord[] = [];
  const stepDone = learnerFinishedStep(event, prev, next);
  if (stepDone) out.push({ hodeId, kind: "step_done", detail: currentStep(prev)?.objective, at });
  const hodeyDone = event.type === "HODEY_ACTED" && prev.pack && next.hodeyDid > prev.hodeyDid;
  if (hodeyDone) out.push({ hodeId, kind: "hodey_step", detail: currentStep(prev)?.objective, at });
  if (next.action?.kind === "correct" && next.action !== prev.action) out.push({ hodeId, kind: "mistake", detail: next.action.speech, at });
  if (event.type === "HINT_REQUESTED" && next !== prev) out.push({ hodeId, kind: "hint", at });
  if (event.type === "STUCK_TIMEOUT" && next !== prev) out.push({ hodeId, kind: "stuck", at });
  if (next.stuck && next.stuck !== prev.stuck) out.push({ hodeId, kind: "stuck", detail: next.stuck.kind, at });
  if (event.type === "ANNOTATION_SUBMITTED" && event.annotation.intent === "ask") out.push({ hodeId, kind: "asked", detail: event.annotation.question, at });
  if (event.type === "PAUSE" && next.phase === "paused") out.push({ hodeId, kind: "paused", at });
  return out;
}

/**
 * What to write for one runtime transition. Pure, so the learning history can be tested without a
 * database; `HodeRecorder` applies the ops.
 */
export function recordFor(event: HodeEvent, prev: HodeState, next: HodeState, hodeId: string | undefined, newId: () => string, at: string): LogOp[] {
  if (started(event, prev, next)) {
    return [{ op: "start", hode: { id: newId(), goal: next.goal, packId: next.pack?.id, open: next.open, startedAt: at } }];
  }
  if (!hodeId) return [];
  const ops: LogOp[] = progressEvents(event, prev, next, at, hodeId).map((e) => ({ op: "event", event: e }));
  if (next.phase === "success" && prev.phase !== "success") ops.push({ op: "end", id: hodeId, outcome: "completed", at });
  else if (event.type === "END_HODE" && ACTIVE_PHASES.has(prev.phase)) ops.push({ op: "end", id: hodeId, outcome: "ended", at });
  // Back to idle any other way (an answer dismissed with nothing to resume): the Hode is over, not "in progress".
  else if (next.phase === "idle" && ACTIVE_PHASES.has(prev.phase)) ops.push({ op: "end", id: hodeId, outcome: "ended", at });
  return ops;
}

/** Writes the learning history as the Hode runs. Write failures are logged and never stop a Hode. */
export class HodeRecorder {
  private hodeId: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly log: HodeLog,
    private readonly onWritten: () => void = () => undefined,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  observe = (event: HodeEvent, prev: HodeState, next: HodeState): void => {
    const ops = recordFor(event, prev, next, this.hodeId, this.newId, this.now());
    for (const op of ops) {
      if (op.op === "start") this.hodeId = op.hode.id;
      if (op.op === "end") this.hodeId = undefined;
      this.queue = this.queue.then(() => this.apply(op)).catch((error) => console.error("Saving the Hode history failed", error));
    }
  };

  /** Resolves once every queued write has been attempted. */
  flushed(): Promise<void> {
    return this.queue;
  }

  private async apply(op: LogOp): Promise<void> {
    if (op.op === "start") await this.log.startHode(op.hode);
    else if (op.op === "event") await this.log.logEvent(op.event);
    else await this.log.endHode(op.id, op.outcome, op.at);
    this.onWritten();
  }
}
