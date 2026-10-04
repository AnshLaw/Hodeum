import type { Loadable } from "../app/hooks";
import type { DeviceRow } from "../features/sync/types";

/**
 * A PC checks in every 30 s, but Windows may slow a hidden window's timers to once a minute: allow for
 * that, a missed beat and some clock skew.
 */
export const ONLINE_WINDOW_MS = 150_000;

export function isOnline(device: DeviceRow, now: number): boolean {
  return now - Date.parse(device.last_seen_at) <= ONLINE_WINDOW_MS;
}

/**
 * The learner's chosen PC while it's online, otherwise the one seen most recently. A remembered choice
 * that has gone quiet (an old install on the same PC) mustn't hide the copy of Hodeum that's running.
 */
export function pickDevice(devices: DeviceRow[], preferredId: string | undefined, now = Date.now()): DeviceRow | undefined {
  const preferred = devices.find((d) => d.id === preferredId);
  if (preferred && isOnline(preferred, now)) return preferred;
  return [...devices].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0];
}

/** Why the dashboard has no PC to send a Hode to. A PC appears once Hodeum there is signed in to this account with sync on. */
export function noPcMessage(devices: Loadable<DeviceRow[]>, email: string | undefined): string {
  if (devices.state === "loading") return "Still looking for your PCs…";
  if (devices.state === "error") return `Couldn't load your PCs: ${devices.message}. Reload the page to try again.`;
  const account = email ?? "the same Google account";
  return `No PC is linked to ${account} yet. In the Hodeum app on your PC: Settings › Account › Sign in with ${email ? "this account" : "it"}, with sync on. If it says sign-in didn't finish or sync failed, use Try again there.`;
}
