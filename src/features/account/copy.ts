import { timeAgo } from "../../app/view";
import type { AccountStatus } from "./types";

export const ACCOUNT_COPY = {
  signInLabel: "Sign in with Google",
  signInDetail: "Signing in turns on sync: your skills, Hodes, settings and chats go to your Hodeum account, so the web dashboard and your other PCs see them and can start Hodes here. Screenshots and audio never leave this PC. You can pause sync any time.",
  waiting: "Finish signing in in your browser…",
  syncLabel: "Sync this PC",
  local: "Everything stays on this PC",
  paused: "Sync paused · on this PC only",
  notConfigured: "Accounts aren't set up in this build. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local (see docs/accounts-setup.md).",
} as const;

/** The rail's footnote: where the learner's data lives right now. */
export function railNote(status: AccountStatus | undefined): string {
  if (status?.phase !== "signed-in") return ACCOUNT_COPY.local;
  if (status.paused) return ACCOUNT_COPY.paused;
  if (status.sync.state === "blocked") return ACCOUNT_COPY.local;
  return `Syncing to ${status.user?.email ?? status.user?.name ?? "your account"}`;
}

export function syncDetail(status: AccountStatus, now: Date): string {
  if (status.paused) return "Paused on this PC. Nothing leaves it until you turn sync back on.";
  const { sync } = status;
  if (sync.state === "blocked") return sync.error ?? "This PC's data belongs to another account, so it won't sync here.";
  if (sync.state === "syncing") return "Syncing…";
  if (sync.state === "error") return `Last sync failed: ${sync.error ?? "unknown error"}. Everything is still on this PC; Hodeum will retry.`;
  if (sync.lastSyncedAt) return `Synced ${timeAgo(sync.lastSyncedAt, now)}.`;
  return "Waiting for the first sync…";
}
