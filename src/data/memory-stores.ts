import type { AssistanceLevel, SkillRecord, StepOutcome } from "../lib/types";
import type { SkillStore } from "../providers/interfaces";
import { MemorySkillStore } from "../providers/memory-skill-store";
import type { ChatMessage, ChatStore, ChatThread, HodeDetail, HodeEventRecord, HodeOutcome, HodeRecord, LearningStore } from "./types";

/** In-memory learning history for tests and the browser stage; shares skills with the runtime. */
export class MemoryLearningStore implements LearningStore, SkillStore {
  private readonly hodes = new Map<string, HodeRecord>();
  private readonly events: HodeEventRecord[] = [];

  constructor(private readonly skills = new MemorySkillStore()) {}

  get(skillId: string): Promise<SkillRecord | null> {
    return this.skills.get(skillId);
  }

  recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord> {
    return this.skills.recordOutcome(skillId, outcome);
  }

  async startHode(hode: HodeRecord): Promise<void> {
    this.hodes.set(hode.id, hode);
  }

  async logEvent(event: HodeEventRecord): Promise<void> {
    this.events.push(event);
  }

  async endHode(id: string, outcome: HodeOutcome, at: string): Promise<void> {
    const hode = this.hodes.get(id);
    if (hode) this.hodes.set(id, { ...hode, outcome, endedAt: at });
  }

  async listHodes(limit: number): Promise<HodeRecord[]> {
    return [...this.hodes.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  async getHode(id: string): Promise<HodeDetail | null> {
    const hode = this.hodes.get(id);
    return hode ? { ...hode, events: this.events.filter((e) => e.hodeId === id) } : null;
  }

  async listSkills(): Promise<SkillRecord[]> {
    return this.skills.all();
  }

  async setSkillLevel(skillId: string, level: AssistanceLevel): Promise<void> {
    this.skills.put({ ...(await this.requireSkill(skillId)), last_assistance_level: level, status: level === "independent" ? "mastered" : "learning" });
  }

  async resetSkill(skillId: string): Promise<void> {
    this.skills.remove(skillId);
  }

  private async requireSkill(skillId: string): Promise<SkillRecord> {
    const skill = await this.skills.get(skillId);
    if (!skill) throw new Error(`Unknown skill: ${skillId}`);
    return skill;
  }
}

export class MemoryChatStore implements ChatStore {
  private readonly chats = new Map<string, ChatThread>();
  private readonly all: ChatMessage[] = [];

  async listChats(): Promise<ChatThread[]> {
    return [...this.chats.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createChat(title: string, at: string): Promise<ChatThread> {
    const chat = { id: crypto.randomUUID(), title, createdAt: at, updatedAt: at };
    this.chats.set(chat.id, chat);
    return chat;
  }

  async messages(chatId: string): Promise<ChatMessage[]> {
    return this.all.filter((m) => m.chatId === chatId);
  }

  async append(message: ChatMessage): Promise<void> {
    this.all.push(message);
    const chat = this.chats.get(message.chatId);
    if (chat) this.chats.set(chat.id, { ...chat, updatedAt: message.at });
  }

  async deleteChat(chatId: string): Promise<void> {
    this.chats.delete(chatId);
    for (let i = this.all.length - 1; i >= 0; i--) if (this.all[i].chatId === chatId) this.all.splice(i, 1);
  }
}
