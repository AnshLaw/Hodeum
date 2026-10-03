export const ASSISTANCE_LEVELS = ["demonstrate", "guide", "hint", "observe", "independent"] as const;
export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

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

export type ElementSource = "uia" | "detector" | "vlm" | "mock";

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
}

export type StateSignal =
  | { kind: "element_visible"; names: string[] }
  | { kind: "element_absent"; names: string[] }
  | { kind: "element_selected"; names: string[] }
  | { kind: "window_title_contains"; text: string };

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

export type TeachingActionKind = "guide" | "correct" | "answer" | "clarify";

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
