import type {
  AppLaunch,
  AssistanceLevel,
  PerformRequest,
  Rect,
  ScreenObservation,
  SkillRecord,
  StepOutcome,
  TeachingAction,
  TeachingContext,
} from "../lib/types";

/** What a reasoner tells the Hode while it works, and how the Hode calls it off. */
export interface ReasoningHooks {
  /** The request reached a slow reasoner (a vision model or the cloud), so Hodey shows it's thinking. */
  onThinking?(): void;
  /** Aborted once the Hode has moved on (a newer request, a pause, the end): stop working on this one. */
  signal?: AbortSignal;
}

/** A reasoner that didn't take a request (it isn't one it may see, or one it can answer well). Not a failure. */
export class ReasonerSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ReasonerSkipped";
  }
}

/** Local planners, Qwen3-VL, and (opt-in) Gemini all implement this. The Hode engine never sees which. */
export interface ReasoningProvider {
  readonly id: string;
  reason(input: TeachingContext, hooks?: ReasoningHooks): Promise<TeachingAction>;
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
  /** Opens `app` (with the pack's practice file) and brings it to the front. False when it didn't appear in time. */
  launchApp?(app: string, launch: AppLaunch): Promise<boolean>;
  /** Fires when the learner's front window becomes a different window. */
  onAppSwitched?(handler: () => void): () => void;
  /** Agent · Do it for me: presses a control for the learner. Rejects when it's no longer where it was seen. */
  perform?(request: PerformRequest): Promise<void>;
}

export interface SkillStore {
  get(skillId: string): Promise<SkillRecord | null>;
  recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord>;
}
