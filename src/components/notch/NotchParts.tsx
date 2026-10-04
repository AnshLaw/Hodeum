import type { PointerEvent, ReactNode } from "react";
import { activeChannels, type ActivityChannel, type ActivityState } from "../../lib/activity";
import type { SpeechInputStatus } from "../../providers/speech/speech-input";
import { COPY } from "../../lib/copy";
import { HodeyFace } from "../hodey/HodeyFace";
import type { HodeyMood } from "../hodey/mood";
import { CheckIcon, CloseIcon, CrosshairIcon, ExpandIcon, EyeIcon, IconButton, MicIcon, MoreIcon, MutedIcon, PauseIcon, RepeatIcon, VolumeIcon } from "../shared/icons";
import { providerBadge, type NotchControl, type NotchView, type StepItem } from "./notch-view";
import { useEnhanced } from "./cloud-context";

const LABELS: Record<NotchControl, string> = {
  start: COPY.startHode,
  point: COPY.pointAndAsk,
  hint: COPY.hint,
  explain: COPY.explain,
  let_me_try: COPY.letMeTry,
  pause: COPY.pause,
  resume: COPY.resume,
  end: COPY.end,
  retry: COPY.retry,
  dismiss: COPY.gotIt,
  cancel_annotate: COPY.cancel,
  repeat: COPY.repeat,
  look_again: COPY.lookAgain,
  all_steps: COPY.allSteps,
};
/** Hodey's face in the notch bar, in CSS px. */
/** Fits the bar with room for Hodey's z's and sound waves, so nothing is clipped. */
const HODEY_BAR_SIZE = 34;
const PRIMARY = new Set<NotchControl>(["start", "resume", "retry", "dismiss"]);

function iconFor(control: NotchControl): ReactNode {
  switch (control) {
    case "point":
      return <CrosshairIcon />;
    case "pause":
      return <PauseIcon />;
    case "end":
      return <CloseIcon />;
    case "repeat":
      return <RepeatIcon />;
    case "look_again":
      return <EyeIcon />;
    default:
      return null;
  }
}

type OnControl = (control: NotchControl) => void;

export function ControlButtons({ controls, hintLabel, onControl, spread = false }: { controls: NotchControl[]; hintLabel?: string; onControl: OnControl; spread?: boolean }) {
  const textControls = controls.filter((c) => iconFor(c) === null);
  const iconControls = controls.filter((c) => iconFor(c) !== null);
  return (
    <div className={spread ? "notch__actions" : "notch__inline-actions"}>
      {textControls.map((c) => (
        <button key={c} type="button" className={PRIMARY.has(c) ? "btn btn--primary" : "btn"} onClick={() => onControl(c)}>
          {c === "hint" && hintLabel ? hintLabel : LABELS[c]}
        </button>
      ))}
      {spread && iconControls.length > 0 && <span className="notch__spacer" />}
      {iconControls.map((c) => (
        <IconButton key={c} label={LABELS[c]} danger={c === "end"} onClick={() => onControl(c)}>
          {iconFor(c)}
        </IconButton>
      ))}
    </div>
  );
}

export function IdleActions({ onControl }: { onControl: OnControl }) {
  return (
    <span className="idle-actions">
      <button type="button" className="btn btn--primary btn--small" onClick={() => onControl("start")}>
        {COPY.startHode}
      </button>
      <IconButton label={COPY.pointAndAsk} onClick={() => onControl("point")}>
        <CrosshairIcon />
      </IconButton>
    </span>
  );
}

export function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <span className="step-dots" role="img" aria-label={COPY.stepOf(current + 1, total)}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-state={i < current ? "done" : i === current ? "current" : "todo"} />
      ))}
    </span>
  );
}

/** "● Local" or "☁ Enhanced": whether any cloud provider may receive learning context right now. */
export function LocalBadge() {
  const badge = providerBadge(useEnhanced());
  return (
    <span className={`local-badge local-badge--${badge.variant}`} title={badge.title} role="status">
      {badge.label}
    </span>
  );
}

export function StepList({ steps }: { steps: StepItem[] }) {
  return (
    <section className="sidebar__steps" aria-label={COPY.steps}>
      <p className="dock-menu__label">{COPY.steps}</p>
      <ol>
        {steps.map((step) => (
          <li key={step.id} data-state={step.state}>
            <span className="sidebar__step-mark" aria-hidden="true">
              {step.state === "done" ? <CheckIcon /> : null}
            </span>
            {step.objective}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SkillChips({ skills }: { skills: string[] }) {
  return (
    <ul className="skill-chips">
      {skills.map((skill) => (
        <li key={skill}>
          <CheckIcon />
          {skill}
        </li>
      ))}
    </ul>
  );
}

/** Hodey's face is the drag handle: press and drag it to another edge to re-dock. */
export function Grip({ onGrip, children }: { onGrip: () => void; children: ReactNode }) {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) onGrip();
  };
  return (
    <span className="notch__grip" onPointerDown={onPointerDown}>
      {children}
    </span>
  );
}

const PRIVACY_LABELS: Record<ActivityChannel, string> = {
  screen: COPY.privacyScreen,
  mic: COPY.privacyMic,
  cloud: COPY.privacyCloud,
};

/** Green = reading the screen, orange = mic on, blue = cloud. Only shown while active, like iOS. */
export function PrivacyDots({ activity, className = "" }: { activity: ActivityState; className?: string }) {
  const channels = activeChannels(activity);
  if (channels.length === 0) return null;
  return (
    <span className={`privacy-dots ${className}`} role="status" aria-label={channels.map((c) => PRIVACY_LABELS[c]).join(", ")}>
      {channels.map((channel) => (
        <i key={channel} data-channel={channel} title={PRIVACY_LABELS[channel]} />
      ))}
    </span>
  );
}

export function MicButton({ status, onToggle }: { status: SpeechInputStatus; onToggle: () => void }) {
  const listening = status === "listening";
  return (
    <button type="button" className={`icon-btn mic-btn${listening ? " mic-btn--live" : ""}`} aria-pressed={listening} aria-label={listening ? COPY.micStop : COPY.mic} title={listening ? COPY.micStop : COPY.mic} data-unavailable={status === "unavailable" || undefined} onClick={onToggle}>
      <MicIcon />
    </button>
  );
}

export interface BarProps {
  view: NotchView;
  mood: HodeyMood;
  expanded: boolean;
  muted: boolean;
  menuOpen: boolean;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onControl: OnControl;
  onGrip: () => void;
  activity: ActivityState;
  micStatus: SpeechInputStatus;
  onToggleMic: () => void;
  onOpenApp: () => void;
}

export function NotchBar(props: BarProps) {
  const { view, mood, expanded, muted, menuOpen, onToggleMute, onToggleMenu, onControl, onGrip } = props;
  const showInline = !expanded && !menuOpen && view.mode !== "idle";
  return (
    <header className="notch__bar">
      {view.busy && <span className="notch__scan" aria-hidden="true" />}
      <Grip onGrip={onGrip}>
        <HodeyFace mood={mood} size={HODEY_BAR_SIZE} />
        <span className={expanded || menuOpen ? "notch__eyebrow" : "notch__bar-title"}>{menuOpen ? COPY.hodeySettings : expanded ? (view.eyebrow ?? COPY.idleTitle) : view.title}</span>
      </Grip>
      {view.progress && !menuOpen && <StepDots {...view.progress} />}
      <span className="notch__spacer" />
      {view.mode === "idle" && !menuOpen && <IdleActions onControl={onControl} />}
      {showInline && <ControlButtons controls={view.controls} onControl={onControl} />}
      <MicButton status={props.micStatus} onToggle={props.onToggleMic} />
      {view.mode !== "idle" && (
        <IconButton label={muted ? COPY.unmute : COPY.mute} onClick={onToggleMute}>
          {muted ? <MutedIcon /> : <VolumeIcon />}
        </IconButton>
      )}
      {(expanded || menuOpen || view.mode === "idle") && (
        <IconButton label={COPY.openApp} onClick={props.onOpenApp}>
          <ExpandIcon />
        </IconButton>
      )}
      <IconButton label={COPY.hodeySettings} onClick={onToggleMenu} pressed={menuOpen}>
        <MoreIcon />
      </IconButton>
      <PrivacyDots activity={props.activity} />
      <LocalBadge />
    </header>
  );
}

/** `extra` replaces the plain skill chips, e.g. the success card's skill progress. */
export function NotchContent({ view, expanded, fallbackDetail, onControl, extra }: { view: NotchView; expanded: boolean; fallbackDetail?: string; onControl: OnControl; extra?: ReactNode }) {
  const detail = view.detail ?? (view.mode === "idle" ? fallbackDetail : undefined);
  if (!expanded) return detail ? <p className="notch__subline">{detail}</p> : null;
  return (
    <div className="notch__content">
      {/* Keyed by text so each new instruction animates in instead of swapping silently. */}
      <p key={view.title} className="notch__title">
        {view.mode === "success" && <CheckIcon />}
        {view.title}
      </p>
      {detail && (
        <p key={detail} className="notch__detail">
          {detail}
        </p>
      )}
      {extra ?? (view.skills && <SkillChips skills={view.skills} />)}
      {view.steps && <StepList steps={view.steps} />}
      {view.controls.length > 0 && <ControlButtons controls={view.controls} hintLabel={view.hintLabel} onControl={onControl} spread />}
    </div>
  );
}
