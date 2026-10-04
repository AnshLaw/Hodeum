import type {
  AssistanceLevel,
  Rect,
  ScreenObservation,
  SkillRecord,
  StepOutcome,
  TeachingAction,
  TeachingContext,
} from "../lib/types";

/** Local planners, Qwen3-VL, and (opt-in) Gemini all implement this. The Hode engine never sees which. */
export interface ReasoningProvider {
  readonly id: string;
  reason(input: TeachingContext): Promise<TeachingAction>;
  healthCheck(): Promise<boolean>;
}

export interface TTSProvider {
  speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export interface MemoryQuery {
  /** The task pack's title, never the learner's own words (those can go to a cloud memory). */
  goal: string;
  skillIds: string[];
}

export interface LearningMemory {
  /** "" when a note (e.g. a Backboard memory) names no skill of the query. */
  skillId: string;
  note: string;
  /** Where the summary said to start next time; only local summaries carry it. */
  level?: AssistanceLevel;
  at?: string;
}

export interface HodeLearningSummary {
  hode: string;
  completed: boolean;
  skills_practiced: string[];
  needed_help_with: string[];
  independent_steps: number;
  guided_steps: number;
  preferred_language: string;
  next_assistance_level: AssistanceLevel;
}

export interface MemoryProvider {
  getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]>;
  storeLearningSummary(summary: HodeLearningSummary): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/** UI Automation, the detector, and the practice stage's mock all sit behind this. */
export interface PerceptionAdapter {
  observe(region?: Rect): Promise<ScreenObservation>;
  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void;
  /** Brings an open window of `app` (e.g. "Excel") to the front. False when none is open. */
  focusApp?(app: string): Promise<boolean>;
}

export interface SkillStore {
  get(skillId: string): Promise<SkillRecord | null>;
  recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord>;
}
