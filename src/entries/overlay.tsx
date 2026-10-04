// First, so component styles of equal specificity win in dev as they do in release builds.
import "../components/shared/base.css";
import { TauriBus } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { connectAppearance } from "../lib/appearance";
import { openDatabase } from "../data/sql";
import { SqliteSettingsStore } from "../data/sqlite-stores";
import { GuidanceOverlay } from "../components/overlay/GuidanceOverlay";
import { mount } from "./mount";

const bus = new TauriBus();
mount(<GuidanceOverlay bus={bus} shell={new TauriShell()} />);

// Highlights use the learner's accent; until settings load (or if they can't), the default amber stays.
openDatabase().then(
  (db) => connectAppearance(new SqliteSettingsStore(db), bus, document.documentElement),
  (error) => console.error("The overlay couldn't open settings; keeping the default accent", error),
);
