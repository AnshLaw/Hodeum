import { z } from "zod";
import type { PhoneSourceKind } from "./phone-source";

const STORAGE_KEY = "hodeum.phone";
const prefsSchema = z.object({
  source: z.enum(["camera", "airplay"]),
  cameraLabel: z.string().optional(),
  airplayNetwork: z.enum(["direct", "wifi"]).optional(),
});
// AirPlay needs no extra hardware or driver, so it is the source a first-time learner can actually use.
const DEFAULT_PREFS: PhonePrefs = { source: "airplay" };

/**
 * Mirrors `NetworkChoice` in src-tauri/src/phone/airplay.rs. "direct" (the default): the iPhone's USB
 * tether or this laptop's hotspot, which guest Wi-Fi and VPNs can't block. "wifi": the laptop's own Wi-Fi.
 */
export type AirplayNetworkChoice = "direct" | "wifi";

export interface PhonePrefs {
  source: PhoneSourceKind;
  cameraLabel?: string;
  airplayNetwork?: AirplayNetworkChoice;
}

export function parsePhonePrefs(raw: string | null): PhonePrefs {
  if (raw === null) return DEFAULT_PREFS;
  try {
    const parsed = prefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFS;
  } catch (error) {
    console.warn("Saved iPhone settings were unreadable; using defaults", error);
    return DEFAULT_PREFS;
  }
}

/** Per-machine choice (camera names differ between PCs), so it stays in this webview, not in synced settings. */
export function loadPhonePrefs(): PhonePrefs {
  try {
    return parsePhonePrefs(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn("Couldn't read iPhone settings; using defaults", error);
    return DEFAULT_PREFS;
  }
}

export function savePhonePrefs(prefs: PhonePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("Couldn't save iPhone settings", error);
  }
}
