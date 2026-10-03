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
  goal: string;
  skillIds: string[];
}

export interface LearningMemory {
  skillId: string;
  note: string;
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
}

export interface SkillStore {
  get(skillId: string): Promise<SkillRecord | null>;
  recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord>;
}
