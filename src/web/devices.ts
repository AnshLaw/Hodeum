import type { DeviceRow } from "../features/sync/types";

/** A PC checks in every 30 s; allow for one missed heartbeat and some clock skew. */
export const ONLINE_WINDOW_MS = 75_000;

export function isOnline(device: DeviceRow, now: number): boolean {
  return now - Date.parse(device.last_seen_at) <= ONLINE_WINDOW_MS;
}

/** The learner's chosen PC if it still exists, otherwise the one seen most recently. */
export function pickDevice(devices: DeviceRow[], preferredId: string | undefined): DeviceRow | undefined {
  return devices.find((d) => d.id === preferredId) ?? [...devices].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))[0];
}
