import type { SkillRecord, StepOutcome } from "../lib/types";
import { applyOutcome } from "../features/hode/policy";
import type { SkillStore } from "./interfaces";

/** In-memory skill store for tests and the browser practice stage. */
export class MemorySkillStore implements SkillStore {
  private readonly records = new Map<string, SkillRecord>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async get(skillId: string): Promise<SkillRecord | null> {
    return this.records.get(skillId) ?? null;
  }

  async recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord> {
    const next = applyOutcome(this.records.get(skillId) ?? null, skillId, outcome, this.now());
    this.records.set(skillId, next);
    return next;
  }
}
