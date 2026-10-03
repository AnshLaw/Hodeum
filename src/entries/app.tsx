import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef } from "react";
import { HodeumApp } from "../app/App";
import type { AppServices } from "../app/services";
import { TauriWindowSource } from "../app/tauri-services";
import { fold, unfold } from "../app/unfold";
import { MemoryChatStore, MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore } from "../data/settings";
import { openDatabase } from "../data/sql";
import { SqliteChatStore, SqliteLearningStore, SqliteSettingsStore } from "../data/sqlite-stores";
import { connectAppearance } from "../lib/appearance";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import type { Rect } from "../lib/types";
import { QwenChatProvider } from "../providers/vision/qwen-chat-provider";
import { TauriVisionStatus } from "../providers/vision/tauri-vision-status";
import { connectionOf, type VisionStatus } from "../providers/vision/types";
import { TASK_PACKS } from "../task-packs";
import "../app/app.css";
import { mount } from "./mount";

/** Sent by Rust each time the app is shown: the notch's rect in this window's CSS px, or null. */
const UNFOLD_EVENT = "app:unfold";
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

/** The window grows out of the notch on show and folds back into it before hiding. */
function NativeFrame({ base }: { base: Omit<AppServices, "window"> }) {
  const frame = useRef<HTMLDivElement>(null);
  const origin = useRef<Rect | undefined>(undefined);
  const folding = useRef<Animation | undefined>(undefined);

  useEffect(
    () =>
      subscribeTauri<Rect | null>(UNFOLD_EVENT, (from) => {
        const element = frame.current;
        if (!element) return;
        origin.current = from ?? undefined;
        folding.current?.cancel();
        element.style.opacity = "";
        unfold(element, origin.current);
      }),
    [],
  );

  const services = useMemo<AppServices>(() => {
    const window = getCurrentWindow();
    const report = (what: string) => (error: unknown) => console.error(`Couldn't ${what} the Hodeum window`, error);
    return {
      ...base,
      window: {
        minimize: () => void window.minimize().catch(report("minimize")),
        toggleMaximize: () => void window.toggleMaximize().catch(report("maximize")),
        close: () => {
          const element = frame.current;
          const hide = () => void window.hide().catch(report("hide"));
          if (!element) return hide();
          folding.current = fold(element, origin.current);
          folding.current.finished.then(hide, hide);
        },
      },
    };
  }, [base]);

  return (
    <div ref={frame} className="native-app" style={{ opacity: 0 }}>
      <HodeumApp services={services} />
    </div>
  );
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const vision = new TauriVisionStatus();
  const stores = await openStores();
  connectAppearance(stores.settings, bus, document.documentElement);
  const base: Omit<AppServices, "window"> = {
    ...stores,
    bus,
    packs: TASK_PACKS,
    vision,
    chat: new QwenChatProvider({ connection: () => connectionOf(vision.current()), unavailableReason: () => unavailableReason(vision.current()) }),
    windows: new TauriWindowSource(bus),
  };
  mount(<NativeFrame base={base} />);
}

boot().catch((error) => console.error("The Hodeum app failed to start", error));
