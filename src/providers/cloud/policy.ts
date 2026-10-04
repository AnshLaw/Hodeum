import type { CloudProvider, CloudSettings } from "../../data/settings";

/** After a cloud failure, skip that provider this long so each step doesn't wait on its timeout again. */
export const COOLDOWN_MS = 60_000;

export interface ActiveApp {
  app: string;
  windowTitle: string;
}

export interface CloudPolicyDeps {
  settings: () => CloudSettings;
  /** Which providers have a saved key (the keys themselves stay in Rust). */
  keys: () => Record<CloudProvider, boolean>;
  activeApp: () => ActiveApp | undefined;
  now?: () => number;
}

/** What the notch badge needs: whether any cloud provider may receive learning context right now. */
export interface CloudState {
  enhanced(): boolean;
  subscribe(listener: () => void): () => void;
}

function toggled(cloud: CloudSettings, provider: CloudProvider): boolean {
  if (provider === "gemini") return cloud.reasoning;
  if (provider === "elevenlabs") return cloud.voice;
  return cloud.memory !== "off";
}

export function isSensitive(app: ActiveApp | undefined, sensitiveApps: readonly string[]): boolean {
  if (!app) return false;
  const haystack = `${app.app}\n${app.windowTitle}`.toLowerCase();
  return sensitiveApps.some((name) => haystack.includes(name.toLowerCase()));
}

/**
 * Decides, per request, whether a cloud provider may run: its toggle is on, its key is saved, the
 * active app isn't sensitive, and it hasn't just failed. Anything else means the local path.
 */
export class CloudPolicy implements CloudState {
  private readonly failedAt = new Map<CloudProvider, number>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly deps: CloudPolicyDeps) {
    this.now = deps.now ?? Date.now;
  }

  allowed(provider: CloudProvider): boolean {
    const cloud = this.deps.settings();
    if (!toggled(cloud, provider) || !this.deps.keys()[provider]) return false;
    if (isSensitive(this.deps.activeApp(), cloud.sensitiveApps)) return false;
    const failed = this.failedAt.get(provider);
    return failed === undefined || this.now() - failed >= COOLDOWN_MS;
  }

  /** Backboard may be written only in "auto"; "readonly" recalls without storing. */
  writesMemory(): boolean {
    return this.allowed("backboard") && this.deps.settings().memory === "auto";
  }

  enhanced(): boolean {
    return (["gemini", "elevenlabs", "backboard"] as const).some((provider) => this.allowed(provider));
  }

  reportFailure(provider: CloudProvider): void {
    this.failedAt.set(provider, this.now());
    this.changed();
  }

  reportSuccess(provider: CloudProvider): void {
    if (this.failedAt.delete(provider)) this.changed();
  }

  /** Settings, keys or the active app changed: the badge may need to flip. */
  changed(): void {
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
