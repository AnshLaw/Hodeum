/** What Hodeum's sign-in page sends back to the desktop: Google's ID token and the state it was given. */
export interface GoogleCallback {
  idToken: string;
  state: string;
}

export interface AccountUser {
  id: string;
  email?: string;
  name?: string;
}

/** `blocked`: signed in to an account this PC's data doesn't belong to; nothing syncs. */
export type SyncState = "off" | "idle" | "syncing" | "error" | "blocked";

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
