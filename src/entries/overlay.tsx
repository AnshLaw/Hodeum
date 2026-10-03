import { TauriBus } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { GuidanceOverlay } from "../components/overlay/GuidanceOverlay";
import { mount } from "./mount";

mount(<GuidanceOverlay bus={new TauriBus()} shell={new TauriShell()} />);
