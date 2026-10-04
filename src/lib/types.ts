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
}

export type StateSignal =
  | { kind: "element_visible"; names: string[] }
  | { kind: "element_absent"; names: string[] }
  | { kind: "element_selected"; names: string[] }
  | { kind: "window_title_contains"; text: string }
  /** `names` must be visible too, so a dark lock screen or a black frame never counts. */
  | { kind: "screen_tone"; tone: ScreenTone; names?: string[] };

export interface TaskStep {
  id: string;
  objective: string;
  skill: string;
  /**
   * `prefer: "selected"` points at a selected item inside the matched container (one of the files
   * the learner selected) instead of the whole container; the container stays the fallback.
   */
  target: { names: string[]; role?: string; label?: string; prefer?: "selected" };
  speech: Record<AssistanceLevel, string>;
  explain: string;
  success: StateSignal;
  mistakes: { signal: StateSignal; correction: string }[];
  /** How the target is pressed; left when absent. */
  press?: MouseButton;
  /** Agent · Do it for me pauses after this step so the learner can check Hodey's work. */
  checkpoint?: boolean;
}

export interface TaskPack {
  id: string;
  title: string;
  app: string;
  /** Defaults to "windows". Phone packs are taught on the mirrored iPhone, read by OCR. */
  surface?: Surface;
  goalPhrases: string[];
  prerequisites: string[];
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
  | { kind: "pin"; bounds: Rect };
