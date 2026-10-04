import type { Bus } from "../lib/bus";
import type { TaskPack } from "../lib/types";
import type { ChatMessage, ChatStore, LearningStore } from "../data/types";
import type { SettingsStore } from "../data/settings";
import type { CapturedFrame, VisionStatusSource } from "../providers/vision/types";
import type { WebSearch, WebSearchSource } from "../providers/web/types";

/** An open app window the learner can attach to a chat as context. */
export interface WindowInfo {
  id: string;
  title: string;
  app: string;
}

export interface WindowSource {
  list(): Promise<WindowInfo[]>;
  /** The app the learner was in before opening Hodeum: the default chat context. */
  lastActive(): Promise<WindowInfo | undefined>;
  capture(id: string): Promise<CapturedFrame>;
}

/** Streams Hodey's reply to a chat, optionally looking at an attached window. */
export interface ChatProvider {
  reply(history: ChatMessage[], frame: CapturedFrame | undefined, signal: AbortSignal, web?: WebSearch): AsyncIterable<string>;
  /** A generic web query for the latest message, decided locally; undefined when none is needed. */
  searchQuery?(history: ChatMessage[], signal: AbortSignal): Promise<string | undefined>;
}

export interface AppWindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

/** Everything the desktop app (and later the web app) needs; swapped for in-memory versions in the stage. */
export interface AppServices {
  learning: LearningStore;
  chats: ChatStore;
  settings: SettingsStore;
  bus: Bus;
  packs: TaskPack[];
  chat?: ChatProvider;
  windows?: WindowSource;
  vision?: VisionStatusSource;
  /** Opt-in (Settings > webSearch); only scrubbed queries leave the PC. */
  web?: WebSearchSource;
  window: AppWindowControls;
  /** Why chat or window context isn't available here (e.g. the browser stage has no local model). */
  limitation?: string;
}
