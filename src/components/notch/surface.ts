import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { DockController } from "./use-dock";
import type { HodeyMood } from "../hodey/mood";
import type { NotchControl, NotchView, StepItem } from "./notch-view";

/** Everything the top notch and the sidebar render from; both are views over the same state. */
export interface SurfaceProps {
  view: NotchView;
  mood: HodeyMood;
  steps: StepItem[];
  hovered: boolean;
  revealed: boolean;
  muted: boolean;
  menuOpen: boolean;
  dock: DockController;
  packs: TaskPack[];
  shell: NativeShell;
  bootNotice?: string;
  onControl: (control: NotchControl) => void;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onGrip: () => void;
  onSubmitGoal: (goal: string) => void;
}
