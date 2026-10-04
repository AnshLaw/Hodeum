import { timeAgo } from "../../app/view";
import { PRESENCE_PREFIX } from "../sync/device-link";
import type { AccountStatus } from "./types";

export const ACCOUNT_COPY = {
  signInLabel: "Sign in with Google",
  signInDetail: "Signing in turns on sync: your skills, Hodes, settings and chats go to your Hodeum account, so the web dashboard and your other PCs see them and can start Hodes here. Screenshots and audio never leave this PC. You can pause sync any time.",
  waiting: "Finish signing in in your browser…",
  railSignInHint: "Sync your progress with the web dashboard and your other PCs.",
  manageAccount: "Account and sync settings",
  homeSignInTitle: "Keep your progress everywhere",
  homeSignInDetail: "Sign in with Google to see your Hodes and skills on the web dashboard and start Hodes on this PC from anywhere. Screenshots and audio never leave this PC.",
  syncLabel: "Sync this PC",
  local: "Everything stays on this PC",
  paused: "Sync paused · on this PC only",
  syncFailed: "Sync failed · see Settings › Account",
  signInFailed: "Sign-in didn't finish · see Settings › Account",
  retry: "Try again",
  syncFailedLabel: "Sync needs attention",
  syncFailedDetail: "Hodeum keeps retrying on its own; try now once the problem above is fixed.",
  notConfigured: "Accounts aren't set up in this build. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local (see docs/accounts-setup.md).",
} as const;

/** The rail's footnote: where the learner's data lives right now. */
export function railNote(status: AccountStatus | undefined): string {
  if (status?.phase === "signed-out" && status.error) return ACCOUNT_COPY.signInFailed;
  if (status?.phase !== "signed-in") return ACCOUNT_COPY.local;
  if (status.paused) return ACCOUNT_COPY.paused;
  if (status.sync.state === "blocked") return ACCOUNT_COPY.local;
  if (status.sync.state === "error") return ACCOUNT_COPY.syncFailed;
  return `Syncing to ${status.user?.email ?? status.user?.name ?? "your account"}`;
}

/** A presence problem already reads as a sentence; anything else is a sync failure. */
const failure = (error: string | undefined) => (error?.startsWith(PRESENCE_PREFIX) ? error : `Last sync failed: ${error ?? "unknown error"}`);

export function syncDetail(status: AccountStatus, now: Date): string {
  if (status.paused) return "Paused on this PC. Nothing leaves it until you turn sync back on.";
  const { sync } = status;
  if (sync.state === "blocked") return sync.error ?? "This PC's data belongs to another account, so it won't sync here.";
  if (sync.state === "syncing") return "Syncing…";
  if (sync.state === "error") return `${failure(sync.error)}. Everything is still on this PC; Hodeum will retry.`;
  if (sync.lastSyncedAt) return `Synced ${timeAgo(sync.lastSyncedAt, now)}.`;
  return "Waiting for the first sync…";
}
