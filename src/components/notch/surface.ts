import type { HodeMode } from "../../lib/types";
import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { DockController } from "./use-dock";
import type { ActivityState } from "../../lib/activity";
import type { SpeechInputStatus } from "../../providers/speech/speech-input";
import type { HodeyMood } from "../hodey/mood";
import type { VisionStatus } from "../../providers/vision/types";
import type { NotchControl, NotchView, StepItem } from "./notch-view";
import type { Bus } from "../../lib/bus";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import type { NotchSkills } from "./use-skills";

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
  onSubmitGoal: (goal: string, mode: HodeMode) => void;
  /** The running Hode's mode, and the learner's default for a new one. */
  hodeMode: HodeMode;
  defaultMode: HodeMode;
  /** A Hode is running, so the mode can be switched from the menu. */
  hodeActive: boolean;
  onSetMode: (mode: HodeMode) => void;
  activity: ActivityState;
  micStatus: SpeechInputStatus;
  /** A short message (e.g. why the mic can't start) shown for a few seconds. */
  toast?: string;
  /** Live words while the learner talks. */
  heard?: string;
  onToggleMic: () => void;
  onOpenApp: () => void;
  bus: Bus;
  /** The iPhone mirror (desktop app only; the stage has none). */
  phone?: PhoneMirror;
  phoneOpen?: boolean;
  /** Shows or hides the iPhone mirror; absent where there is no mirror. */
  onTogglePhone?: () => void;
  /** The learner's skill graph and this Hode's progress; absent where no skill store is readable. */
  skills?: NotchSkills;
}
