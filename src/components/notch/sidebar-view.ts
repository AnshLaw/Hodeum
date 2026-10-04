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

export interface SidebarShapeState {
  revealed: boolean;
  /** The slim tab, rather than an open panel. */
  collapsed: boolean;
  panelOpen: boolean;
}

/**
 * The side dock's shape classes: the tucked orb, the slim tab, the full-height panel, or the card a hover opens.
 * Tucked is the orb alone: a stretched panel's rules would pull it to the dock's full height.
 */
export function sidebarShape(s: SidebarShapeState): string[] {
  if (!s.revealed) return ["sidebar--tucked"];
  if (s.collapsed) return ["sidebar--collapsed"];
  return s.panelOpen ? ["sidebar--active"] : [];
}
