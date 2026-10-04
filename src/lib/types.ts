export const ASSISTANCE_LEVELS = ["demonstrate", "guide", "hint", "observe", "independent"] as const;
export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

/** How Hodey runs a Hode: teach (learn by doing), help (stand by until asked), agent (guide every step). */
export const HODE_MODES = ["teach", "help", "agent"] as const;
export type HodeMode = (typeof HODE_MODES)[number];

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

export interface ScreenObservation {
  app: string;
  windowTitle: string;
  elements: UiElement[];
  at: number;
  tone?: ScreenTone;
}

export type StateSignal =
  | { kind: "element_visible"; names: string[] }
  | { kind: "element_absent"; names: string[] }
  | { kind: "element_selected"; names: string[] }
  | { kind: "window_title_contains"; text: string }
  | { kind: "screen_tone"; tone: ScreenTone };

export interface TaskStep {
  id: string;
  objective: string;
  skill: string;
  target: { names: string[]; role?: string; label?: string };
  speech: Record<AssistanceLevel, string>;
  explain: string;
  success: StateSignal;
  mistakes: { signal: StateSignal; correction: string }[];
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
  | { kind: "highlight"; bounds: Rect; label?: string; emphasis: "precise" | "broad" }
  | { kind: "arrow"; to: Rect }
  | { kind: "pin"; bounds: Rect };
