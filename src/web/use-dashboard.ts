import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppServices } from "../app/services";
import { MemoryChatStore } from "../data/memory-stores";
import { connectAppearance } from "../lib/appearance";
import type { DeviceRow } from "../features/sync/types";
import { TASK_PACKS } from "../task-packs";
import { WebBus, type CommandFeedback } from "./command-bus";
import type { Loadable } from "../app/hooks";
import { noPcMessage, pickDevice } from "./devices";
import { SupabaseCommandSender, SupabaseLearningStore, SupabaseSettingsStore, listDevices, watchAccount } from "./supabase-web";

const CHOSEN_PC_KEY = "hodeum.web.pc";
/** Re-reads PCs so "online" stays true to the clock even when nothing changes. */
const DEVICE_REFRESH_MS = 30_000;
/** Coalesces a burst of Realtime row changes into one reload. */
const PROGRESS_DEBOUNCE_MS = 500;

export type { Loadable };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function readChosen(): string | undefined {
  try {
    return localStorage.getItem(CHOSEN_PC_KEY) ?? undefined;
  } catch (error) {
    console.error("Couldn't read the chosen PC; picking the most recent", error);
    return undefined;
  }
}

function saveChosen(id: string): void {
  try {
    localStorage.setItem(CHOSEN_PC_KEY, id);
  } catch (error) {
    console.error("Couldn't remember the chosen PC", error);
  }
}

/** The signed-in Supabase session, kept live. */
export function useSession(client: SupabaseClient): Loadable<Session | null> {
  const [session, setSession] = useState<Loadable<Session | null>>({ state: "loading" });
  useEffect(() => {
    client.auth.getSession().then(
      ({ data, error }) => setSession(error ? { state: "error", message: error.message } : { state: "ready", value: data.session }),
      (error: unknown) => setSession({ state: "error", message: errorText(error) }),
    );
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession({ state: "ready", value: next }));
    return () => data.subscription.unsubscribe();
  }, [client]);
  return session;
}

export interface Dashboard {
  services: Omit<AppServices, "window">;
  devices: Loadable<DeviceRow[]>;
  target?: DeviceRow;
  choose(id: string): void;
  feedback?: CommandFeedback;
}

function useDevices(client: SupabaseClient): [Loadable<DeviceRow[]>, () => void] {
  const [devices, setDevices] = useState<Loadable<DeviceRow[]>>({ state: "loading" });
  const reload = useCallback(() => {
    listDevices(client).then(
      (value) => setDevices({ state: "ready", value }),
      (error: unknown) => {
        console.error("Couldn't load your PCs", error);
        setDevices({ state: "error", message: errorText(error) });
      },
    );
  }, [client]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, DEVICE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);
  return [devices, reload];
}

/** Everything the dashboard pages need, over the learner's account. */
export function useDashboard(client: SupabaseClient, email: string | undefined): Dashboard {
  const [devices, reloadDevices] = useDevices(client);
  const [chosen, setChosen] = useState(readChosen);
  const [feedback, setFeedback] = useState<CommandFeedback>();
  const target = devices.state === "ready" ? pickDevice(devices.value, chosen) : undefined;
  const targetRef = useRef(target);
  targetRef.current = target;
  const noPcRef = useRef("");
  noPcRef.current = noPcMessage(devices, email);
  const services = useMemo(() => {
    const bus = new WebBus(new SupabaseCommandSender(client), () => targetRef.current, setFeedback, () => noPcRef.current);
    return { learning: new SupabaseLearningStore(client), chats: new MemoryChatStore(), settings: new SupabaseSettingsStore(client), bus, packs: TASK_PACKS };
  }, [client]);
  useEffect(() => connectAppearance(services.settings, services.bus, document.documentElement), [services]);
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const progress = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => services.bus.emit("data:changed", {}), PROGRESS_DEBOUNCE_MS);
    };
    const off = watchAccount(client, { devices: reloadDevices, progress });
    return () => {
      clearTimeout(debounce);
      off();
    };
  }, [client, services, reloadDevices]);
  // The chosen PC's live Hode drives "Continue your Hode" on Home.
  useEffect(() => services.bus.emit("hode:summary-request", {}), [services, target?.id, JSON.stringify(target?.live)]);
  const choose = (id: string) => {
    saveChosen(id);
    setChosen(id);
  };
  return { services, devices, target, choose, feedback };
}
