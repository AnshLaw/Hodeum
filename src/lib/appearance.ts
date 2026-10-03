import type { Accent, Appearance, HodeyColor, SettingsStore, Theme } from "../data/settings";
import type { Bus } from "./bus";

/** Guidance accent: highlights, primary buttons, the scan line and the orb ring. */
const ACCENT_TOKENS: Record<Accent, { accent: string; hover: string; ink: string }> = {
  amber: { accent: "#ffb224", hover: "#ffc457", ink: "#1f1300" },
  mint: { accent: "#3dd68c", hover: "#62e3a4", ink: "#00210f" },
  sky: { accent: "#4cb8ff", hover: "#73c8ff", ink: "#001d33" },
  rose: { accent: "#ff6b8a", hover: "#ff8ea6", ink: "#33000b" },
  violet: { accent: "#a78bfa", hover: "#bba5fb", ink: "#170838" },
};

const HODEY_TOKENS: Record<HodeyColor, { skin: string; shade: string; ink: string }> = {
  amber: { skin: "#ffb224", shade: "#ec9a00", ink: "#1f1300" },
  mint: { skin: "#4fe0a0", shade: "#22c07c", ink: "#00210f" },
  sky: { skin: "#6cc4ff", shade: "#3aa6ef", ink: "#00213a" },
  coral: { skin: "#ff8a6b", shade: "#f06a48", ink: "#2e0a00" },
  violet: { skin: "#b49cff", shade: "#9277f5", ink: "#1a0b3d" },
  snow: { skin: "#f4f4f5", shade: "#d4d4d8", ink: "#18181b" },
};

export const ACCENT_SWATCHES: Record<Accent, string> = Object.fromEntries(Object.entries(ACCENT_TOKENS).map(([k, v]) => [k, v.accent])) as Record<Accent, string>;
export const HODEY_SWATCHES: Record<HodeyColor, string> = Object.fromEntries(Object.entries(HODEY_TOKENS).map(([k, v]) => [k, v.skin])) as Record<HodeyColor, string>;

export function hodeyVars(color: HodeyColor): Record<string, string> {
  const hodey = HODEY_TOKENS[color];
  return { "--hd-hodey-skin": hodey.skin, "--hd-hodey-shade": hodey.shade, "--hd-hodey-ink": hodey.ink };
}

export function appearanceVars(appearance: Appearance): Record<string, string> {
  const accent = ACCENT_TOKENS[appearance.accent];
  return { "--hd-accent": accent.accent, "--hd-accent-hover": accent.hover, "--hd-accent-ink": accent.ink, ...hodeyVars(appearance.hodeyColor) };
}

export function resolveTheme(theme: Theme, systemDark: boolean): "dark" | "light" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Paints a window: accent and Hodey variables, Hodey's accessory, and the resolved theme. */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  for (const [name, value] of Object.entries(appearanceVars(appearance))) root.style.setProperty(name, value);
  root.dataset.hodeyAccessory = appearance.hodeyAccessory;
  root.dataset.theme = resolveTheme(appearance.theme, window.matchMedia(DARK_QUERY).matches);
}

/** Re-applies when the system theme flips (for the "system" choice). Returns a disposer. */
export function followSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export interface VoiceOption {
  name: string;
  voiceURI: string;
  lang: string;
  localService: boolean;
}

/** Only on-device voices: "Online (Natural)" voices send the text to a cloud service. */
export function localVoices<T extends VoiceOption>(voices: T[]): T[] {
  return voices.filter((voice) => voice.localService);
}

/** Keeps a window's look in step with saved settings: at boot, on `settings:changed`, and on system theme flips. */
export function connectAppearance(settings: SettingsStore, bus: Bus, root: HTMLElement): () => void {
  let current: Appearance | undefined;
  const load = () =>
    settings.load().then(
      (loaded) => {
        current = loaded.appearance;
        applyAppearance(root, current);
      },
      (error) => console.error("Couldn't load the appearance settings; keeping the current look", error),
    );
  void load();
  const offs = [bus.on("settings:changed", () => void load()), followSystemTheme(() => current && applyAppearance(root, current))];
  return () => offs.forEach((off) => off());
}
