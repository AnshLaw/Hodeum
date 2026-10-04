import type { SidebarStyle, Visibility } from "../../features/dock/dock";
import type { NotchMode } from "./notch-view";

export interface SidebarState {
  mode: NotchMode;
  listening: boolean;
  style: SidebarStyle;
  visibility: Visibility;
  phoneOpen: boolean;
}

/**
 * Whether the side dock shows its full panel. A pinned copilot keeps it open (Windows already gave it
 * the space); listening opens it so the learner sees what Hodey hears; the iPhone mirror needs it.
 */
export function sidebarPanelOpen(s: SidebarState): boolean {
  return s.mode !== "idle" || s.listening || s.phoneOpen || (s.style === "copilot" && s.visibility === "pinned");
}
