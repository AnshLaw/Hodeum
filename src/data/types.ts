import type { AssistanceLevel, SkillRecord } from "../lib/types";

export type HodeOutcome = "completed" | "ended";

export interface HodeRecord {
  id: string;
  goal: string;
  packId?: string;
  /** Planned step by step by local vision instead of a task pack. */
  open: boolean;
  startedAt: string;
  endedAt?: string;
  outcome?: HodeOutcome;
}

/** `hodey_step`: Agent · Do it for me did the step; it never counts as the learner's. */
export type HodeEventKind = "step_done" | "hodey_step" | "mistake" | "hint" | "stuck" | "asked" | "paused";

export interface HodeEventRecord {
  hodeId: string;
  kind: HodeEventKind;
  /** Step objective, correction text, or question, depending on the kind. */
  detail?: string;
  at: string;
}

export interface HodeDetail extends HodeRecord {
  events: HodeEventRecord[];
}

/** Write side, fed by `HodeRecorder` from the runtime in the notch window. */
export interface HodeLog {
  startHode(hode: HodeRecord): Promise<void>;
  logEvent(event: HodeEventRecord): Promise<void>;
  endHode(id: string, outcome: HodeOutcome, at: string): Promise<void>;
}

export interface LearningStats {
  hodesCompleted: number;
  skillsMastered: number;
  skillsLearning: number;
  /** Consecutive days, ending today or yesterday, on which the learner practised. */
  streakDays: number;
  minutesLearning: number;
}

/** Read side for the app window and the web dashboard. */
export interface LearningStore extends HodeLog {
  /**
   * Ends every Hode left open (Hodeum quit or crashed mid-Hode), at its last recorded activity. Run at
   * startup, when no Hode can be running; otherwise they'd show "in progress" here and on the web for ever.
   */
  closeOpenHodes(): Promise<number>;
  listHodes(limit: number): Promise<HodeRecord[]>;
  getHode(id: string): Promise<HodeDetail | null>;
  listSkills(): Promise<SkillRecord[]>;
  setSkillLevel(skillId: string, level: AssistanceLevel): Promise<void>;
  resetSkill(skillId: string): Promise<void>;
}

export type ChatRole = "user" | "hodey";

export interface ChatMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  /** Which window was attached as context, e.g. "Sales.xlsx - Excel". */
  context?: string;
  /** The web search behind a reply: the exact query sent and the sources used. */
  web?: { query: string; sources: { title: string; url: string }[] };
  at: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStore {
  listChats(): Promise<ChatThread[]>;
  createChat(title: string, at: string): Promise<ChatThread>;
  messages(chatId: string): Promise<ChatMessage[]>;
  append(message: ChatMessage): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
}
