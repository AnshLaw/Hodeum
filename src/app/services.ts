import type { Bus } from "../lib/bus";
import type { TaskPack } from "../lib/types";
import type { ChatMessage, ChatStore, LearningStore } from "../data/types";
import type { CloudProvider, Settings, SettingsStore } from "../data/settings";
import type { CloudCatalog } from "../providers/cloud/catalog";
import type { KeyPresence } from "../providers/cloud/keys";
import type { CapturedFrame, VisionStatusSource } from "../providers/vision/types";
import type { WebSearch, WebSearchSource } from "../providers/web/types";
import type { NaturalVoice } from "../providers/speech/native-voice";

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

/** Hodey's natural (Supertonic) voices on this PC, for choosing and previewing in Settings. */
export interface VoicePreview {
  /** Hodey's natural voices; empty when not installed or still loading. */
  naturalVoices(): NaturalVoice[];
  subscribe(listener: () => void): () => void;
  preview(voice: Settings["voice"], text: string): Promise<void>;
}

/** Cloud API keys in Windows Credential Manager. Keys go in; only their presence comes back. */
export interface CloudKeyService {
  current(): KeyPresence;
  refresh(): Promise<KeyPresence>;
  save(provider: CloudProvider, key: string): Promise<void>;
  clear(provider: CloudProvider): Promise<void>;
}

export interface AppWindowControls {
  minimize(): void;
  toggleMaximize(): void;
  /** Folds the app back into the notch and hides it; the notch comes back. Hodey keeps running. */
  close(): void;
  /** Maximized or not, for the maximize/restore button; absent where the window can't maximize. */
  onMaximizedChange?(listener: (maximized: boolean) => void): () => void;
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
  /** Absent in the browser stage, which previews with Windows voices only. */
  voice?: VoicePreview;
  /** Opt-in (Settings > webSearch); only scrubbed queries leave the PC. */
  web?: WebSearchSource;
  /** Absent on the web dashboard: keys live on the learner's PC. */
  cloudKeys?: CloudKeyService;
  /** Models and voices for Settings > Cloud, listed with the saved keys; absent where keys aren't. */
  cloudCatalog?: CloudCatalog;
  /** Opens an https page in the default browser; absent where a plain link already does that. */
  openLink?: (url: string) => Promise<void>;
  window: AppWindowControls;
  /** Why chat or window context isn't available here (e.g. the browser stage has no local model). */
  limitation?: string;
}
