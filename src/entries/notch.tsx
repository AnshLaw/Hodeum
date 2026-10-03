import { COPY } from "../lib/copy";
import { TauriBus } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { Notch } from "../components/notch/Notch";
import { HodeRuntime } from "../features/hode/runtime";
import type { SkillStore } from "../providers/interfaces";
import { MemorySkillStore } from "../providers/memory-skill-store";
import { SqliteSkillStore } from "../providers/sqlite-skill-store";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { UnavailablePerception } from "../providers/unavailable-perception";
import { WebSpeechTTSProvider } from "../providers/web-speech-tts";
import { TASK_PACKS } from "../task-packs";
import { mount } from "./mount";

async function openSkills(): Promise<{ skills: SkillStore; notice?: string }> {
  try {
    return { skills: await SqliteSkillStore.open() };
  } catch (error) {
    console.error("Opening the skill database failed; progress is kept in memory for this session", error);
    return { skills: new MemorySkillStore(), notice: COPY.progressNotSaved };
  }
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const { skills, notice } = await openSkills();
  const runtime = new HodeRuntime({
    perception: new UnavailablePerception(),
    reasoners: [new TaskPackReasoningProvider()],
    skills,
    bus,
    tts: new WebSpeechTTSProvider(),
  });
  mount(<Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} />);
}

boot().catch((error) => console.error("Hodey failed to start", error));
