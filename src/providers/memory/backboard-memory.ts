import type { KeyValueStore } from "../../data/kv";
import type { CloudPolicy } from "../cloud/policy";
import type { HodeLearningSummary, LearningMemory, MemoryProvider, MemoryQuery } from "../interfaces";

/** One Backboard assistant per Hodian: its memories carry across that Hodian's Hodes (PRD §18.1). */
export const ASSISTANT_ID_KEY = "backboard.assistant_id";
/** Backboard memories recalled per Hode start; local memory stays the main source. */
const MAX_CLOUD_MEMORIES = 5;
/** Backboard's add-message memory mode that saves new memories (verified against docs.backboard.io). */
const SAVE_MEMORY = "Auto";
const SUMMARY_PREAMBLE = "Hodeum end-of-Hode learning summary for this learner (compact; no transcript). Remember what they practised, what they needed help with, and where to start next time:";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface BackboardDeps {
  invoke: Invoke;
  policy: Pick<CloudPolicy, "allowed" | "writesMemory" | "reportFailure" | "reportSuccess">;
  kv: KeyValueStore;
}

/** What `backboard_search_memories` returns (src-tauri/src/cloud/backboard.rs `MemoryItem`). */
interface BackboardMemory {
  content: string;
}

/** The only thing Backboard ever receives about a Hode: the compact summary, as JSON. */
export function summaryMessage(summary: HodeLearningSummary): string {
  return `${SUMMARY_PREAMBLE}\n${JSON.stringify(summary)}`;
}

function toLearningMemory(memory: BackboardMemory, skillIds: string[]): LearningMemory {
  return { skillId: skillIds.find((skill) => memory.content.includes(skill)) ?? "", note: memory.content };
}

/**
 * Opt-in cloud learning memory. Runs only while the cloud policy allows Backboard, writes only in
 * "auto" (never "readonly"), and reports failures to the policy so it cools down; callers fall back
 * to local memory. Keys and HTTP stay in Rust.
 */
export class BackboardMemoryProvider implements MemoryProvider {
  readonly id = "backboard";
  private assistantId: Promise<string> | undefined;

  constructor(private readonly deps: BackboardDeps) {}

  /** Searched by skill ids alone: `goal` may be the learner's own words, which stay on this PC. */
  async getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]> {
    if (query.skillIds.length === 0 || !this.deps.policy.allowed("backboard")) return [];
    const assistantId = await this.deps.kv.get(ASSISTANT_ID_KEY);
    if (!assistantId) return [];
    const memories = await this.reported(() =>
      this.deps.invoke<BackboardMemory[]>("backboard_search_memories", { assistantId, query: query.skillIds.join(" "), limit: MAX_CLOUD_MEMORIES }),
    );
    return memories.map((memory) => toLearningMemory(memory, query.skillIds));
  }

  /** An open Hode has no skills, and its `hode` is the learner's own goal words: those stay local. */
  async storeLearningSummary(summary: HodeLearningSummary): Promise<void> {
    if (!this.deps.policy.writesMemory() || summary.skills_practiced.length === 0) return;
    await this.reported(async () => {
      const assistantId = await this.assistant();
      const threadId = await this.deps.invoke<string>("backboard_create_thread", { assistantId });
      await this.deps.invoke<void>("backboard_add_message", { threadId, content: summaryMessage(summary), memory: SAVE_MEMORY });
    });
  }

  async healthCheck(): Promise<boolean> {
    return this.deps.policy.allowed("backboard");
  }

  /** The saved assistant, or a new one saved for next time. Concurrent callers share one creation. */
  private assistant(): Promise<string> {
    this.assistantId ??= this.loadOrCreateAssistant().catch((error: unknown) => {
      this.assistantId = undefined;
      throw error;
    });
    return this.assistantId;
  }

  private async loadOrCreateAssistant(): Promise<string> {
    const saved = await this.deps.kv.get(ASSISTANT_ID_KEY);
    if (saved) return saved;
    const created = await this.deps.invoke<string>("backboard_create_assistant");
    await this.deps.kv.set(ASSISTANT_ID_KEY, created);
    return created;
  }

  /** One attempt, no retry loop: a failure starts the policy's cooldown and is rethrown. */
  private async reported<T>(work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      this.deps.policy.reportSuccess("backboard");
      return result;
    } catch (error) {
      this.deps.policy.reportFailure("backboard");
      throw error;
    }
  }
}
