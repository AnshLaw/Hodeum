import type { CloudSettings } from "../../data/settings";
import type { KeyPresence } from "../../providers/cloud/keys";

/** The notch's switch: everything on this PC, or the cloud services the learner has keys for. */
export type CloudMode = "local" | "cloud";

export function cloudMode(cloud: CloudSettings): CloudMode {
  return cloud.reasoning || cloud.voice || cloud.memory !== "off" ? "cloud" : "local";
}

/**
 * Switching to Cloud turns on every service with a saved key (memory as it was, or recall-and-save);
 * switching to Local turns them all off. Chosen models and voices are kept for next time.
 */
export function withCloudMode(cloud: CloudSettings, mode: CloudMode, keys: KeyPresence): CloudSettings {
  if (mode === "local") return { ...cloud, reasoning: false, voice: false, memory: "off" };
  const memory = keys.backboard ? (cloud.memory === "off" ? "auto" : cloud.memory) : "off";
  return { ...cloud, reasoning: keys.gemini, voice: keys.elevenlabs, memory };
}

export const anyKey = (keys: KeyPresence): boolean => keys.gemini || keys.elevenlabs || keys.backboard;
