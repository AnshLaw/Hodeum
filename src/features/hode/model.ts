import type { ReplyLanguage } from "../../lib/language";
import type {
  AgentStyle,
  AppLaunch,
  AssistanceLevel,
  DialogueTurn,
  HodeMode,
  LearnerAnnotation,
  OverlayPrimitive,
  PerformRequest,
  PinPrimitive,
  RecallCheck,
  Rect,
  ScreenObservation,
  SkillRecord,
  StepOutcome,
  TaskPack,
  TaskStep,
  TeachingAction,
  TeachingContext,
} from "../../lib/types";
import type { StepAction, StuckSignal } from "./stuck";

export const STUCK_MS = 12_000;
/** Turns of conversation kept for context: three exchanges. */
export const DIALOGUE_TURNS = 6;
export const MAX_WRONG_ACTIONS = 2;
export const QUESTION_PADDING_PX = 16;
/** Agent · Do it for me: how long Hodey shows what it's about to press, so the learner can stop it. */
export const PREVIEW_MS = 1200;
/** Agent · Do it for me checks in with the learner after this many of its own steps, checkpoint or not. */
export const CHECKPOINT_EVERY = 3;
/** Presses of Hodey's own that may fail to finish a step before the learner is asked to do it. */
export const MAX_HODEY_TRIES = 2;

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
  /** Agent · Do it for me: Hodey is about to press, or is pressing, the step's control. */
  | "acting"
  /** Agent · Do it for me: Hodey stopped so the learner can check its work before it carries on. */
  | "checkpoint"
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
  /** The guidance a question interrupted, and the screen read it came from: restored as it was afterwards. */
  resumeAction?: TeachingAction;
  resumeObservation?: ScreenObservation;
  /** The answer on screen has been said in full (or, muted, been up long enough to read). */
  answerSaid?: boolean;
  learnedSkills: string[];
  /** An open-ended Hode: no task pack, planned and verified by the local vision model. */
  open: boolean;
  /** The app this Hode happens in (the pack's, or one an open goal names). */
  app?: string;
  /** That app, while Hodey waits for the learner to open or switch to it. */
  waitingForApp?: string;
  /** Teach (learn by doing), help (stand by until asked) or agent (guide or do every step). */
  mode: HodeMode;
  /** In agent mode: guide the learner through each step, or do it and stop at checkpoints. */
  agentStyle: AgentStyle;
  /** Agent · Do it for me: this step is the learner's, because Hodey couldn't press it safely. */
  handedBack: boolean;
  /** Agent · Do it for me: Hodey's presses this step that didn't finish it. */
  hodeyTries: number;
  /** Agent · Do it for me: steps Hodey did since the learner last checked its work. */
  sinceCheckpoint: number;
  /** Steps Hodey did itself this Hode (they never count as the learner's skills). */
  hodeyDid: number;
  /** Teach mode keeps upcoming steps hidden unless the learner asks to see the whole flow. */
  showAllSteps: boolean;
  /** What Hodey replies in (Settings > Voice > Language); kept across Hodes. */
  language: ReplyLanguage;
  /** The learner's recent actions in this step, for stuck detection (PRD §7). */
  stepActions: StepAction[];
  /** The latest reason Hodey decided the learner was stuck in this step. */
  stuck?: StuckSignal;
  /** An unexpected dialog Hodey asked the learner to close; guidance resumes once it's gone. */
  surprise?: string;
  /** The learner acted while the step was being prepared; only then may the first screen read finish it. */
  actedWhilePreparing?: boolean;
  /** Teach mode's opening (what the learner is about to make), said ahead of the first thing Hodey says about a step. */
  pendingIntro?: string;
  /** "Exactly right." for the step just done, said ahead of the next step's guidance. */
  pendingAck?: string;
  /** Teach mode: the why of the step just done, said after its acknowledgement. */
  pendingReason?: string;
  /** That why, shown on the card until the learner acts again. */
  reason?: string;
  /** The current step's why has been said (in a demonstration, a correction, or Explain). */
  whySaid?: boolean;
  /** A short line said once, ahead of the next guidance ("I can't see that done yet."). */
  pendingNote?: string;
  /** The learner said they did the step ("I did it", look again): the next screen read may finish it. */
  claimedDone?: boolean;
  /** Hodey couldn't see the step done when the learner said it was: Skip is offered for the rest of the step. */
  offerSkip?: boolean;
  /** The screen read in hand just finished the previous step: the next step starts from it if it shows its control. */
  freshRead?: boolean;
  /** Teach mode's closing question, once the Hode is done, and the answer the learner picked. */
  review?: { check: RecallCheck; picked?: number };
  /** A practice round: the same lesson again, every step watched rather than prompted. */
  practice?: boolean;
  /** Hodey gave more help than the step started with at least once this Hode. */
  neededHelp?: boolean;
  /** Open-ended Hodes: the instructions the learner has carried out, oldest first. */
  openDone?: string[];
  /** Open-ended Hodes: the learner did something that mattered since the instruction on show was given. */
  actedSinceInstruction?: boolean;
  /** The last few turns of the conversation this Hode, oldest first (see `withTurn`). */
  dialogue?: DialogueTurn[];
  /** That acknowledgement, shown in the notch until the learner acts again. */
  ack?: string;
  /** The last acknowledgement used, so the next one is a different phrase. */
  lastAck?: string;
  /** The running request reached a slow reasoner (vision model or cloud); cheap local re-checks never set it. */
  thinking?: boolean;
  /** The instruction Hodey last said in this step: an unprompted re-plan that lands on it again only moves the highlight. */
  instructionSaid?: string;
  /** The learner asked for this guidance (a hint, "where?", look again, a new mode, coming back): it's said even if unchanged. */
  prompted?: boolean;
  /** The stuck timer already explained and reset this step at the most help; it now waits for the learner. */
  toppedOut?: boolean;
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
  agentStyle: "guide",
  handedBack: false,
  hodeyTries: 0,
  sinceCheckpoint: 0,
  hodeyDid: 0,
  showAllSteps: false,
  open: false,
  language: "en",
  stepActions: [],
};

export type HodeEvent =
  | { type: "START_HODE" }
  /** `openAllowed`: no pack matched, but the local vision model is ready to plan step by step. */
  | { type: "GOAL_SUBMITTED"; goal: string; pack?: TaskPack; openAllowed?: boolean; /** Named in an open goal. */ app?: string; mode?: HodeMode; agentStyle?: AgentStyle }
  /** `remembered`: where learning memory says to start this skill (nudges the start by one step at most). */
  | { type: "SKILL_LOADED"; skillId: string; record: SkillRecord | null; remembered?: AssistanceLevel }
  /** Switch teach / help / agent, mid-Hode too. */
  | { type: "SET_MODE"; mode: HodeMode }
  /** Agent mode's style (switches to agent mode too), mid-Hode too. */
  | { type: "SET_AGENT_STYLE"; style: AgentStyle }
  /** Hodey's own press landed and the screen was read again. */
  | { type: "HODEY_ACTED"; requestId: number; observation: ScreenObservation }
  /** Hodey's own press couldn't be made (the control moved, or this app can't be driven). */
  | { type: "PERFORM_FAILED"; requestId: number; message: string }
  /** Settings changed what Hodey replies in. */
  | { type: "SET_LANGUAGE"; language: ReplyLanguage }
  /** Teach mode: show (or hide again) the steps still to come. */
  | { type: "SHOW_ALL_STEPS" }
  | { type: "OBSERVED"; observation: ScreenObservation }
  | { type: "ACTION_READY"; requestId: number; action: TeachingAction; failures: string[] }
  /** Request `requestId` reached a slow reasoner (vision model or cloud): now Hodey is really thinking. */
  | { type: "THINKING"; requestId: number }
  | { type: "LEARNER_ACTED"; observation: ScreenObservation }
  | { type: "STUCK_TIMEOUT" }
  /** The learner said they can't find it ("where?", "I don't see it", "कहाँ है"). */
  | { type: "SAID_STUCK" }
  | { type: "HINT_REQUESTED" }
  /** "Show me": straight to a full demonstration of the step. */
  | { type: "SHOW_ME" }
  | { type: "EXPLAIN_REQUESTED" }
  /** Speak the current instruction or answer again. */
  | { type: "REPEAT" }
  /** A spoken question about the screen (no marked area). */
  | { type: "VOICE_QUESTION"; question: string }
  /** The learner asks Hodey to re-read the screen now (PRD §11 "look again"). */
  | { type: "LOOK_AGAIN" }
  | { type: "LET_ME_TRY" }
  /** Past a step Hodey can't see done; nothing is learned or failed for it. */
  | { type: "SKIP_STEP" }
  /** An answer to the closing question: tapped (`option`) or said (`said`). */
  | { type: "REVIEW_ANSWERED"; option?: number; said?: string }
  /** The same lesson again, with Hodey only watching. */
  | { type: "PRACTICE_AGAIN" }
  | { type: "ANNOTATE_START" }
  | { type: "ANNOTATE_CANCEL" }
  | { type: "ANNOTATION_SUBMITTED"; annotation: LearnerAnnotation }
  | { type: "DISMISS" }
  /** Hodey said its last line in full (or, muted, it has been up long enough to read). */
  | { type: "SPEECH_FINISHED" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "END_HODE" }
  | { type: "RETRY" }
  | { type: "PROVIDER_FAILED"; requestId?: number; message: string };

export type EventOf<T extends HodeEvent["type"]> = Extract<HodeEvent, { type: T }>;

export type HodeEffect =
  /** `launch`: open the app (with its practice file) instead of only bringing an open window forward. */
  | { type: "focusApp"; app: string; launch?: AppLaunch }
  | { type: "loadSkill"; skillId: string }
  | { type: "observe"; region?: Rect }
  | { type: "reason"; requestId: number; context: TeachingContext }
  /** Press a control after `delayMs`, unless the Hode moved on (another request, or no longer acting). */
  | { type: "perform"; requestId: number; request: PerformRequest; delayMs: number }
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

/**
 * Reasoning that only re-checks guidance already shown, unasked (after the learner's action, a scroll):
 * the guidance stays up, marked busy while a slow reasoner works, instead of Hodey visibly "thinking".
 */
export function rechecking(s: HodeState): boolean {
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  // Asked for (a hint, look again) and a slow reasoner is on it: show Hodey working instead.
  const shownWorking = s.thinking === true && s.prompted === true;
  return s.phase === "reasoning" && !shownWorking && !asking && s.action !== undefined && s.action.kind !== "answer";
}

/** The conversation with one more turn, keeping only the last few. */
export function withTurn(dialogue: DialogueTurn[] | undefined, turn: DialogueTurn): DialogueTurn[] {
  return [...(dialogue ?? []), turn].slice(-DIALOGUE_TURNS);
}

/** Help with an open goal, before anyone asked: Hodey watches and leaves the vision model alone. */
export function standingBy(s: HodeState): boolean {
  return s.open && s.mode === "help" && (s.level === "observe" || s.level === "independent");
}

/** The learner's mark as an overlay pin, drawn only over the window they marked it on. */
export function pinOf(annotation: LearnerAnnotation | undefined): PinPrimitive | undefined {
  if (!annotation) return undefined;
  const bounds = annotation.shape.bounds;
  return annotation.window ? { kind: "pin", bounds, window: annotation.window } : { kind: "pin", bounds };
}

export function pinFor(state: HodeState): PinPrimitive | undefined {
  return pinOf(state.question ?? state.focusRegion);
}

export function pinOverlay(annotation: LearnerAnnotation | undefined): HodeEffect {
  const pin = pinOf(annotation);
  return pin ? { type: "renderOverlay", primitives: [pin] } : { type: "clearOverlay" };
}
