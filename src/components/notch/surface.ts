import type { AgentStyle, HodeMode } from "../../lib/types";
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
import type { VoiceSetup } from "../../features/voice/hardware";
import type { NaturalVoice } from "../../providers/speech/native-voice";
import type { VoiceMenuKind } from "./VoiceMenu";
import type { CloudSetup } from "./CloudMenu";

/** Everything the top notch and the sidebar render from; both are views over the same state. */
export interface SurfaceProps {
  view: NotchView;
  mood: HodeyMood;
  steps: StepItem[];
  hovered: boolean;
  /** Out in full; otherwise auto-hide has tucked it into a small orb at the screen edge. */
  revealed: boolean;
  /** Brings the notch out of the orb, as hovering does (a click on the orb). */
  onReveal: () => void;
  muted: boolean;
  menuOpen: boolean;
  dock: DockController;
  packs: TaskPack[];
  shell: NativeShell;
  bootNotice?: string;
  vision?: VisionStatus;
  onControl: (control: NotchControl) => void;
  /** An answer to the closing question was tapped. */
  onAnswer?: (option: number) => void;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onGrip: () => void;
  onSubmitGoal: (goal: string, mode: HodeMode, agentStyle: AgentStyle) => void;
  /** The running Hode's mode, and the learner's default for a new one. */
  hodeMode: HodeMode;
  defaultMode: HodeMode;
  /** The running Hode's agent style, and the learner's default for a new one. */
  hodeAgentStyle: AgentStyle;
  defaultAgentStyle: AgentStyle;
  /** A Hode is running, so the mode can be switched from the menu. */
  hodeActive: boolean;
  onSetMode: (mode: HodeMode) => void;
  onSetAgentStyle: (style: AgentStyle) => void;
  activity: ActivityState;
  micStatus: SpeechInputStatus;
  /** A short message (e.g. why the mic can't start) shown for a few seconds. */
  toast?: string;
  /** Live words while the learner talks. */
  heard?: string;
  onToggleMic: () => void;
  onOpenApp: () => void;
  bus: Bus;
  /** The iPhone mirror. */
  phone?: PhoneMirror;
  phoneOpen?: boolean;
  /** Shows or hides the iPhone mirror; absent where there is no mirror. */
  onTogglePhone?: () => void;
  /** The learner's skill graph and this Hode's progress; absent where no skill store is readable. */
  skills?: NotchSkills;
  /** The mic's or speaker's menu, when open; the voice menus need `voiceSetup`. */
  voiceMenu?: VoiceMenuKind;
  onVoiceMenu?: (kind: VoiceMenuKind) => void;
  voiceSetup?: VoiceSetup;
  /** Cloud services, models and keys for the badge's menu. */
  cloudSetup?: CloudSetup;
  /** Hodey's natural voices, for the speaker's menu. */
  naturalVoices: NaturalVoice[];
}
