import type {
  AssistanceLevel,
  HodeMode,
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
  /** A spoken question being answered right now (about the whole screen). */
  spokenQuestion?: string;
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
  /** An open-ended Hode: no task pack, planned and verified by the local vision model. */
  open: boolean;
  /** The app this Hode happens in (the pack's, or one an open goal names). */
  app?: string;
  /** That app, while Hodey waits for the learner to open or switch to it. */
  waitingForApp?: string;
  /** Teach (learn by doing), help (stand by until asked) or agent (guide every step). */
  mode: HodeMode;
  /** Teach mode keeps upcoming steps hidden unless the learner asks to see the whole flow. */
  showAllSteps: boolean;
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
  mode: "teach",
  showAllSteps: false,
  open: false,
};

export type HodeEvent =
  | { type: "START_HODE" }
  /** `openAllowed`: no pack matched, but the local vision model is ready to plan step by step. */
  | { type: "GOAL_SUBMITTED"; goal: string; pack?: TaskPack; openAllowed?: boolean; /** Named in an open goal. */ app?: string; mode?: HodeMode }
  | { type: "SKILL_LOADED"; skillId: string; record: SkillRecord | null }
  /** Switch teach / help / agent, mid-Hode too. */
  | { type: "SET_MODE"; mode: HodeMode }
  /** Teach mode: show (or hide again) the steps still to come. */
  | { type: "SHOW_ALL_STEPS" }
  | { type: "OBSERVED"; observation: ScreenObservation }
  | { type: "ACTION_READY"; requestId: number; action: TeachingAction; failures: string[] }
  | { type: "LEARNER_ACTED"; observation: ScreenObservation }
  | { type: "STUCK_TIMEOUT" }
  | { type: "HINT_REQUESTED" }
  | { type: "EXPLAIN_REQUESTED" }
  /** Speak the current instruction or answer again. */
  | { type: "REPEAT" }
  /** A spoken question about the screen (no marked area). */
  | { type: "VOICE_QUESTION"; question: string }
  /** The learner asks Hodey to re-read the screen now (PRD §11 "look again"). */
  | { type: "LOOK_AGAIN" }
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
  | { type: "focusApp"; app: string }
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
