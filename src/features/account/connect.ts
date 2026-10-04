import type { ActivityTracker } from "../../lib/activity";
import type { Bus } from "../../lib/bus";
import type { SettingsStore } from "../../data/settings";
import { openDatabase, type SqlDatabase } from "../../data/sql";
import { DeviceLink, type DeviceIdentity } from "../sync/device-link";
import { SyncEngine } from "../sync/engine";
import { SqliteSyncSource } from "../sync/local";
import { BrowserSyncState, recordDeletions } from "../sync/state";
import { SupabaseCloud } from "../sync/supabase-cloud";
import { createSupabase, supabaseConfig } from "./config";
import { AccountService, type AccountPrefs, type SyncSession } from "./service";
import { SupabaseAuth } from "./supabase-auth";
import { TauriLoopback, type TauriLoopbackDeps } from "./tauri-loopback";
import type { AccountUser } from "./types";

const DEVICE_ID_KEY = "hodeum.deviceId";
const PAUSED_KEY = "hodeum.syncPaused";
const FALLBACK_DEVICE_NAME = "Windows PC";

export interface ConnectAccountDeps extends TauriLoopbackDeps {
  bus: Bus;
  settings: SettingsStore;
  activity: ActivityTracker;
}

/** A stable id for this PC, so the web dashboard can address it. */
function deviceId(): string {
  const saved = localStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

async function deviceIdentity(deps: TauriLoopbackDeps): Promise<DeviceIdentity> {
  try {
    return { id: deviceId(), name: (await deps.invoke<string>("device_name")) || FALLBACK_DEVICE_NAME };
  } catch (error) {
    console.error("Couldn't read this PC's name", error);
    return { id: deviceId(), name: FALLBACK_DEVICE_NAME };
  }
}

const browserPrefs: AccountPrefs = {
  paused: () => localStorage.getItem(PAUSED_KEY) === "true",
  setPaused: (paused) => localStorage.setItem(PAUSED_KEY, String(paused)),
};

async function openSyncDatabase(): Promise<SqlDatabase | undefined> {
  try {
    return await openDatabase();
  } catch (error) {
    console.error("Sync is off: the local database didn't open", error);
    return undefined;
  }
}

/**
 * Starts the account in the notch window: Google sign-in, sync and the web command channel.
 * Without a Supabase project (or a database) Hodeum stays local and Settings says why.
 */
export async function connectAccount(deps: ConnectAccountDeps): Promise<AccountService> {
  const { bus, settings, activity } = deps;
  recordDeletions(bus, new BrowserSyncState(localStorage));
  const config = supabaseConfig();
  const db = config ? await openSyncDatabase() : undefined;
  const client = config && db ? createSupabase(config, { detectSessionInUrl: false }) : undefined;
  const device = await deviceIdentity(deps);
  const track = <T>(work: () => Promise<T>) => activity.track("cloud", work);
  const session = (user: AccountUser): SyncSession => {
    if (!client || !db) throw new Error("Sync needs a Supabase project and the local database");
    const cloud = new SupabaseCloud(client, user.id);
    const engine = new SyncEngine({ cloud, local: new SqliteSyncSource(db), settings, state: new BrowserSyncState(localStorage, user.id), bus, track });
    const link = new DeviceLink({ cloud, bus, device, track });
    return {
      start: () => {
        engine.start();
        void link.start();
      },
      stop: () => {
        engine.stop();
        link.stop();
      },
      status: () => engine.status(),
      subscribe: (listener) => engine.subscribe(listener),
    };
  };
  const service = new AccountService({ backend: client && new SupabaseAuth(client), loopback: new TauriLoopback(deps), bus, session, prefs: browserPrefs });
  await service.start();
  return service;
}
