export interface AccountUser {
  id: string;
  email?: string;
  name?: string;
}

export type SyncState = "off" | "idle" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt?: string;
  error?: string;
}

/** What the app window shows in Settings > Account and the rail. */
export interface AccountStatus {
  /** False when this build has no Supabase project configured. */
  configured: boolean;
  phase: "signed-out" | "signing-in" | "signed-in";
  user?: AccountUser;
  /** Sync is paused on this PC (Settings switch); stays signed in. */
  paused: boolean;
  sync: SyncStatus;
  /** Why the last sign-in or sign-out failed. */
  error?: string;
}

export const SIGNED_OUT: AccountStatus = { configured: true, phase: "signed-out", paused: false, sync: { state: "off" } };
