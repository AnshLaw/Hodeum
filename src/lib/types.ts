import type { ReplyLanguage } from "./language";
export const ASSISTANCE_LEVELS = ["demonstrate", "guide", "hint", "observe", "independent"] as const;
export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

/** How Hodey runs a Hode: teach (learn by doing), help (stand by until asked), agent (guide or do every step). */
export const HODE_MODES = ["teach", "help", "agent"] as const;
export type HodeMode = (typeof HODE_MODES)[number];

/** Agent mode's two styles: Hodey guides every step, or does them itself and stops at checkpoints for the learner to check. */
export const AGENT_STYLES = ["guide", "execute"] as const;
export type AgentStyle = (typeof AGENT_STYLES)[number];

export type MouseButton = "left" | "right";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A top-level window of the learner's app: its handle and visible frame (physical screen px). */
export interface WindowRef {
  id: number;
  bounds: Rect;
}

/** A monitor in physical pixels; `scale` is the DPI factor (1.25 = 125%). */
export interface MonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export type ElementSource = "uia" | "detector" | "vlm" | "mock" | "ocr";

/** Where an app lives: the Windows desktop, or the learner's iPhone mirrored into the notch. */
export type Surface = "windows" | "phone";

/** Overall screen brightness; only reported where pixels are read (the phone mirror). */
export type ScreenTone = "dark" | "light";

export interface UiElement {
  id: string;
  name: string;
  role: string;
  /** Physical screen pixels. */
  bounds: Rect;
  source: ElementSource;
  confidence: number;
  selected?: boolean;
}

/**
 * What the learner just did, from the native input hook: where they clicked (physical screen pixels)
 * and undo/back shortcuts. Only these are reported; nothing typed is ever recorded.
 */
export type LearnerInput =
  | { kind: "click"; at: Point; button: MouseButton }
  | { kind: "undo" }
  | { kind: "back" };

export interface ScreenObservation {
  app: string;
  windowTitle: string;
  elements: UiElement[];
  at: number;
  tone?: ScreenTone;
  /** The learner input this read follows, oldest first (learner-action reads only). */
  inputs?: LearnerInput[];
  /** The window that was read; guidance drawn from this read belongs to it. Absent off Windows. */
  window?: WindowRef;
}

export type StateSignal =
  | { kind: "element_visible"; names: string[] }
  | { kind: "element_absent"; names: string[] }
  | { kind: "element_selected"; names: string[] }
  | { kind: "window_title_contains"; text: string }
  /** `names` must be visible too, so a dark lock screen or a black frame never counts. */
  | { kind: "screen_tone"; tone: ScreenTone; names?: string[] };

/** A control's role as UI Automation reports it, or the roles one control may report (Excel's PivotTable: button or split button). */
export type TargetRole = string | string[];

export interface TaskStep {
  id: string;
  objective: string;
  skill: string;
  /**
   * `prefer: "selected"` points at a selected item inside the matched container (one of the files
   * the learner selected) instead of the whole container; the container stays the fallback.
   */
  target: { names: string[]; role?: TargetRole; label?: string; prefer?: "selected" };
  speech: Record<AssistanceLevel, string>;
  explain: string;
  success: StateSignal;
  mistakes: { signal: StateSignal; correction: string }[];
  /** How the target is pressed; left when absent. */
  press?: MouseButton;
  /** Agent · Do it for me pauses after this step so the learner can check Hodey's work. */
  checkpoint?: boolean;
}

/** How Agent mode opens a pack's app: its program, and a practice file shipped with Hodeum to open in it. */
export interface AppLaunch {
  exe: string;
  sample?: string;
}

/** A recall question: retrieving a move from memory is what makes it stick. */
export interface RecallCheck {
  question: string;
  /** Two to four short answers; `answer` is the right one's index. */
  options: string[];
  answer: number;
  /** Said after the learner answers, right or wrong: the idea behind the answer. */
  explain: string;
}

export interface TaskPack {
  id: string;
  title: string;
  app: string;
  launch?: AppLaunch;
  /** Defaults to "windows". Phone packs are taught on the mirrored iPhone, read by OCR. */
  surface?: Surface;
  goalPhrases: string[];
  /** Words that make a goal a different task though it shares this pack's words ("open" a zip isn't zipping). */
  notFor?: string[];
  prerequisites: string[];
  /** Teach mode's opening: what the learner is about to make and why it's worth knowing, in a sentence or two. */
  concept?: string;
  /** Teach mode's closing: the lesson's moves in one line ("Insert, then PivotTable, OK, then the fields"). */
  recap?: string;
  /** Teach mode's closing question: one move of the lesson to recall, with answers to pick from. */
  check?: RecallCheck;
  steps: TaskStep[];
}

export interface ActionTarget {
  elementId: string;
  bounds: Rect;
  confidence: number;
  label: string;
}

/** Agent · Do it for me: the control Hodey presses for the learner, as last seen on screen. */
export interface PerformRequest {
  /** Bounds and id from the screen read, never from a model. */
  target: ActionTarget;
  button: MouseButton;
  /** The element's name as read, re-checked on the native side before clicking. */
  name: string;
  /** Which screen read the element came from (`ScreenObservation.at`); a press of an older read is refused. */
  observedAt: number;
}

/** `complete` ends an open-ended Hode when the screen shows the goal is reached. */
export type TeachingActionKind = "guide" | "correct" | "answer" | "clarify" | "complete";

export interface TeachingAction {
  kind: TeachingActionKind;
  speech: string;
  target?: ActionTarget;
  skill: string;
  assistanceLevel: AssistanceLevel;
}

export type AnnotationShape =
  | { kind: "rect"; bounds: Rect }
  | { kind: "stroke"; points: Point[]; bounds: Rect }
  | { kind: "point"; at: Point; bounds: Rect };

export interface LearnerAnnotation {
  id: string;
  shape: AnnotationShape;
  intent: "ask" | "focus";
  question?: string;
  createdAt: number;
  /** The window the learner marked; the mark is only drawn over it. */
  window?: WindowRef;
}

export interface TeachingContext {
  goal: string;
  pack?: TaskPack;
  step?: TaskStep;
  observation: ScreenObservation;
  assistanceLevel: AssistanceLevel;
  utterance?: string;
  focusRegion?: LearnerAnnotation;
  correction?: string;
  recentMistakes: number;
  /** No task pack: the model plans one step at a time and judges when the goal is done. */
  openGoal?: boolean;
  /** The instruction the learner was last given (open-ended Hodes). */
  lastInstruction?: string;
  /** What to reply in; English when absent. */
  language?: ReplyLanguage;
  /** The learner's last few actions this step, oldest first: what they did and what it changed. */
  recentActions?: ActionSummary[];
}

/** A control by what it is (never by a screen read's id, which changes between reads). */
export interface ControlRef {
  role: string;
  name: string;
}

/** What differs between two screen reads of the learner's app. */
export interface ScreenChange {
  /** Another app or window title. */
  windowChanged: boolean;
  appeared: ControlRef[];
  disappeared: ControlRef[];
  selected: ControlRef[];
  deselected: ControlRef[];
  moved: ControlRef[];
}

/**
 * How a learner action bears on the current step: nothing changed, only noise (hover, status text),
 * progress (the step's target came into view or moved), or off track (anything else that matters).
 */
export type ActionVerdict = "unchanged" | "noise" | "progress" | "off_track";

export interface ActionSummary {
  inputs: LearnerInput["kind"][];
  /** The control the last click landed on, if any. */
  clicked?: ControlRef;
  change: ScreenChange;
  verdict: ActionVerdict;
}

export type SkillStatus = "new" | "learning" | "mastered";

export interface SkillRecord {
  skill_id: string;
  status: SkillStatus;
  confidence: number;
  success_count: number;
  failure_count: number;
  last_assistance_level: AssistanceLevel;
  last_seen_at: string;
}

export interface StepOutcome {
  completed: boolean;
  mistakes: number;
  level: AssistanceLevel;
  escalated: boolean;
}

export type OverlayPrimitive =
  | { kind: "spotlight"; bounds: Rect }
  /** `keepClear`: nearby on-screen text (headings, neighbouring rows) the label shouldn't cover. */
  | { kind: "highlight"; bounds: Rect; label?: string; emphasis: "precise" | "broad"; keepClear?: Rect[] }
  | { kind: "arrow"; to: Rect }
  /** `window`: the window the learner marked it on, when that differs from the guidance's. */
  | { kind: "pin"; bounds: Rect; window?: WindowRef };

export type PinPrimitive = OverlayPrimitive & { kind: "pin" };
