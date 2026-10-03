import { LocalBus } from "../lib/bus";
import { BrowserShell } from "../lib/shell";
import { HodeRuntime } from "../features/hode/runtime";
import { MemorySkillStore } from "../providers/memory-skill-store";
import { MockPerception, type MockApp } from "../providers/mock-perception";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { WebSpeechTTSProvider } from "../providers/web-speech-tts";
import { ExcelScene } from "./scenes/excel";
import { ExplorerScene } from "./scenes/explorer";

export type StageAppId = "excel" | "explorer";

export interface StageEnvironment {
  apps: { excel: ExcelScene; explorer: ExplorerScene };
  bus: LocalBus;
  shell: BrowserShell;
  perception: MockPerception;
  runtime: HodeRuntime;
  select(id: StageAppId): void;
}

/** Wires the real runtime to scripted practice apps, all inside one browser page. */
export function createStageEnvironment(): StageEnvironment {
  const apps = { excel: new ExcelScene(), explorer: new ExplorerScene() };
  let current: MockApp = apps.excel;
  const bus = new LocalBus();
  const perception = new MockPerception(() => current);
  const runtime = new HodeRuntime({
    perception,
    reasoners: [new TaskPackReasoningProvider()],
    skills: new MemorySkillStore(),
    bus,
    tts: new WebSpeechTTSProvider(),
  });
  return {
    apps,
    bus,
    shell: new BrowserShell(),
    perception,
    runtime,
    select(id) {
      current = apps[id];
    },
  };
}
