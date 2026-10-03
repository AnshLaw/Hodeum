import type {
  AssistanceLevel,
  LearnerAnnotation,
  OverlayPrimitive,
  Rect,
  ScreenObservation,
  SkillRecord,
  StepOutcome,
  TaskPack,
  TaskStep,
  TeachingAction,
  TeachingContext,
} from "../../lib/types";

export const STUCK_MS = 12_000;
export const MAX_WRONG_ACTIONS = 2;
export const QUESTION_PADDING_PX = 16;

export type HodePhase =
  | "idle"
  | "goal_entry"
  | "observing"
  | "reasoning"
  | "guiding"
  | "answering"
  | "annotating"
  | "paused"
  | "recovering"
  | "success";

export interface HodeState {
  phase: HodePhase;
  goal: string;
  pack?: TaskPack;
  stepIndex: number;
  level: AssistanceLevel;
  /** Help was raised during this step (mistake, stuck, or hint request). */
  escalated: boolean;
  mistakes: number;
  wrongActions: number;
  action?: TeachingAction;
  observation?: ScreenObservation;
  /** Persistent "Focus here" region for the rest of the Hode. */
  focusRegion?: LearnerAnnotation;
  /** The Point & Ask question being answered right now. */
  question?: LearnerAnnotation;
  correction?: string;
  explanation?: string;
  notice?: string;
  /** Latest reasoning request; results for older ids are stale and dropped. */
  requestId: number;
  reobserved: boolean;
  resumePhase?: HodePhase;
  learnedSkills: string[];
}

export const initialState: HodeState = {
  phase: "idle",
  goal: "",
  stepIndex: 0,
  level: "demonstrate",
  escalated: false,
  mistakes: 0,
  wrongActions: 0,
  requestId: 0,
  reobserved: false,
  learnedSkills: [],
};

export type HodeEvent =
  | { type: "START_HODE" }
  | { type: "GOAL_SUBMITTED"; goal: string; pack?: TaskPack }
  | { type: "SKILL_LOADED"; skillId: string; record: SkillRecord | null }
  | { type: "OBSERVED"; observation: ScreenObservation }
  | { type: "ACTION_READY"; requestId: number; action: TeachingAction; failures: string[] }
  | { type: "LEARNER_ACTED"; observation: ScreenObservation }
  | { type: "STUCK_TIMEOUT" }
  | { type: "HINT_REQUESTED" }
  | { type: "EXPLAIN_REQUESTED" }
  | { type: "LET_ME_TRY" }
  | { type: "ANNOTATE_START" }
  | { type: "ANNOTATE_CANCEL" }
  | { type: "ANNOTATION_SUBMITTED"; annotation: LearnerAnnotation }
  | { type: "DISMISS" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "END_HODE" }
  | { type: "RETRY" }
  | { type: "PROVIDER_FAILED"; requestId?: number; message: string };

export type EventOf<T extends HodeEvent["type"]> = Extract<HodeEvent, { type: T }>;

export type HodeEffect =
  | { type: "loadSkill"; skillId: string }
  | { type: "observe"; region?: Rect }
  | { type: "reason"; requestId: number; context: TeachingContext }
  | { type: "renderOverlay"; primitives: OverlayPrimitive[] }
  | { type: "clearOverlay" }
  | { type: "say"; text: string }
  | { type: "stopSpeech" }
  | { type: "startStuckTimer"; ms: number }
  | { type: "cancelStuckTimer" }
  | { type: "recordOutcome"; skillId: string; outcome: StepOutcome };

export interface Transition {
  state: HodeState;
  effects: HodeEffect[];
}

export function noop(state: HodeState): Transition {
  return { state, effects: [] };
}

export function currentStep(state: HodeState): TaskStep | undefined {
  return state.pack?.steps[state.stepIndex];
}

export function withLeadingEffects(transition: Transition, effects: HodeEffect[]): Transition {
  return { state: transition.state, effects: [...effects, ...transition.effects] };
}

export function pinFor(state: HodeState): Rect | undefined {
  return (state.question ?? state.focusRegion)?.shape.bounds;
}

export function pinOverlay(pin: Rect | undefined): HodeEffect {
  return pin ? { type: "renderOverlay", primitives: [{ kind: "pin", bounds: pin }] } : { type: "clearOverlay" };
}
