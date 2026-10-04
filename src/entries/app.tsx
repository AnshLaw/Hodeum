import { NativeFrame } from "../app/native-frame";
import type { AppServices } from "../app/services";
import { TauriWebSearch, TauriWindowSource } from "../app/tauri-services";
import { MemoryChatStore, MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore } from "../data/settings";
import { openDatabase } from "../data/sql";
import { SqliteChatStore, SqliteLearningStore, SqliteSettingsStore } from "../data/sqlite-stores";
import { invoke } from "@tauri-apps/api/core";
import { trackDeletions } from "../features/sync/deletions";
import { connectAppearance } from "../lib/appearance";
import { CloudKeys } from "../providers/cloud/keys";
import { createLocalVoice, voicePreview } from "../providers/speech/local-voice";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import { QwenChatProvider } from "../providers/vision/qwen-chat-provider";
import { TauriVisionStatus } from "../providers/vision/tauri-vision-status";
import { connectionOf, type VisionStatus } from "../providers/vision/types";
import { TASK_PACKS } from "../task-packs";
import "../app/app.css";
import { mount } from "./mount";

const NO_DATABASE = "Hodeum couldn't open its database, so changes in this window aren't saved. Restart Hodeum to try again.";

function unavailableReason(status: VisionStatus): string {
  if (status.state === "starting") return "Hodey's local model is still loading. Try again in a few seconds.";
  if (status.state === "missing") return "The local model isn't installed yet. Run scripts/setup-local-ai.ps1 once.";
  if (status.state === "failed") return `The local model stopped: ${status.detail}`;
  return "The local model isn't running.";
}

type Stores = Pick<AppServices, "learning" | "chats" | "settings" | "limitation">;

async function openStores(): Promise<Stores> {
  try {
    const db = await openDatabase();
    return { learning: new SqliteLearningStore(db), chats: new SqliteChatStore(db), settings: new SqliteSettingsStore(db) };
  } catch (error) {
    console.error("Opening the Hodeum database failed", error);
    return { learning: new MemoryLearningStore(), chats: new MemoryChatStore(), settings: new MemorySettingsStore(), limitation: NO_DATABASE };
  }
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const vision = new TauriVisionStatus();
  const stores = await openStores();
  trackDeletions(stores.learning, stores.chats, bus);
  connectAppearance(stores.settings, bus, document.documentElement);
  const base: Omit<AppServices, "window"> = {
    ...stores,
    bus,
    packs: TASK_PACKS,
    vision,
    chat: new QwenChatProvider({ connection: () => connectionOf(vision.current()), unavailableReason: () => unavailableReason(vision.current()) }),
    windows: new TauriWindowSource(bus),
    web: new TauriWebSearch(bus),
    cloudKeys: new CloudKeys(invoke),
    voice: voicePreview(createLocalVoice({ invoke, listen: (event, handler) => subscribeTauri(event, handler) })),
  };
  mount(<NativeFrame base={base} />);
}

boot().catch((error) => console.error("The Hodeum app failed to start", error));
