import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { DockController } from "./use-dock";
import type { ActivityState } from "../../lib/activity";
import type { SpeechInputStatus } from "../../providers/speech/speech-input";
import type { HodeyMood } from "../hodey/mood";
import type { VisionStatus } from "../../providers/vision/types";
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
  vision?: VisionStatus;
  onControl: (control: NotchControl) => void;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onGrip: () => void;
  onSubmitGoal: (goal: string) => void;
  activity: ActivityState;
  micStatus: SpeechInputStatus;
  /** A short message (e.g. why the mic can't start) shown for a few seconds. */
  toast?: string;
  /** Live words while the learner talks. */
  heard?: string;
  onToggleMic: () => void;
  onOpenApp: () => void;
}
