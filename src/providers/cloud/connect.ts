import type { Bus } from "../../lib/bus";
import { DEFAULT_SETTINGS, type CloudSettings } from "../../data/settings";
import { CloudKeys } from "./keys";
import { CloudPolicy, type ActiveApp } from "./policy";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface Cloud {
  policy: CloudPolicy;
  keys: CloudKeys;
  /** Settings > Cloud changed (applied by the Hode bridge). */
  apply(cloud: CloudSettings): void;
  /** The foreground app may have changed: re-check the sensitive list for the badge. */
  appChanged(): void;
}

/** The notch's cloud policy: cloud settings, saved-key presence and the active app, kept current. */
export function connectCloud(deps: { invoke: Invoke; bus: Bus; activeApp: () => ActiveApp | undefined }): Cloud {
  let settings: CloudSettings = DEFAULT_SETTINGS.cloud;
  let lastApp = "";
  const keys = new CloudKeys(deps.invoke);
  const policy = new CloudPolicy({ settings: () => settings, keys: () => keys.current(), activeApp: deps.activeApp });
  const refreshKeys = () => keys.refresh().then(() => policy.changed());
  refreshKeys();
  deps.bus.on("cloud:keys-changed", refreshKeys);
  return {
    policy,
    keys,
    apply(cloud) {
      settings = cloud;
      policy.changed();
    },
    appChanged() {
      const app = deps.activeApp();
      const key = app ? `${app.app}\n${app.windowTitle}` : "";
      if (key === lastApp) return;
      lastApp = key;
      policy.changed();
    },
  };
}
