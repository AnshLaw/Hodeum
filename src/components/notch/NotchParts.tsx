import type { PointerEvent, ReactNode } from "react";
import { COPY } from "../../lib/copy";
import { CheckIcon, CloseIcon, CrosshairIcon, HodeyGlyph, IconButton, MoreIcon, MutedIcon, PauseIcon, VolumeIcon } from "../shared/icons";
import type { NotchControl, NotchView } from "./notch-view";

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
};
const PRIMARY = new Set<NotchControl>(["start", "resume", "retry", "dismiss"]);

function iconFor(control: NotchControl): ReactNode {
  switch (control) {
    case "point":
      return <CrosshairIcon />;
    case "pause":
      return <PauseIcon />;
    case "end":
      return <CloseIcon />;
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
        <IconButton key={c} label={LABELS[c]} onClick={() => onControl(c)}>
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

export function LocalBadge() {
  return (
    <span className="local-badge" title="Everything runs on this PC">
      {COPY.local}
    </span>
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

export interface BarProps {
  view: NotchView;
  expanded: boolean;
  muted: boolean;
  menuOpen: boolean;
  onToggleMute: () => void;
  onToggleMenu: () => void;
  onControl: OnControl;
  onGrip: () => void;
}

export function NotchBar({ view, expanded, muted, menuOpen, onToggleMute, onToggleMenu, onControl, onGrip }: BarProps) {
  const showInline = !expanded && !menuOpen && view.mode !== "idle";
  return (
    <header className="notch__bar">
      {view.busy && <span className="notch__scan" aria-hidden="true" />}
      <Grip onGrip={onGrip}>
        <HodeyGlyph />
        <span className={expanded || menuOpen ? "notch__eyebrow" : "notch__bar-title"}>{menuOpen ? COPY.hodeySettings : expanded ? (view.eyebrow ?? COPY.idleTitle) : view.title}</span>
      </Grip>
      {view.progress && !menuOpen && <StepDots {...view.progress} />}
      <span className="notch__spacer" />
      {view.mode === "idle" && !menuOpen && <IdleActions onControl={onControl} />}
      {showInline && <ControlButtons controls={view.controls} onControl={onControl} />}
      {view.mode !== "idle" && (
        <IconButton label={muted ? COPY.unmute : COPY.mute} onClick={onToggleMute}>
          {muted ? <MutedIcon /> : <VolumeIcon />}
        </IconButton>
      )}
      <IconButton label={COPY.hodeySettings} onClick={onToggleMenu} pressed={menuOpen}>
        <MoreIcon />
      </IconButton>
      <LocalBadge />
    </header>
  );
}

export function NotchContent({ view, expanded, fallbackDetail, onControl }: { view: NotchView; expanded: boolean; fallbackDetail?: string; onControl: OnControl }) {
  const detail = view.detail ?? (view.mode === "idle" ? fallbackDetail : undefined);
  if (!expanded) return detail ? <p className="notch__subline">{detail}</p> : null;
  return (
    <div className="notch__content">
      <p className="notch__title">
        {view.mode === "success" && <CheckIcon />}
        {view.title}
      </p>
      {detail && <p className="notch__detail">{detail}</p>}
      {view.skills && <SkillChips skills={view.skills} />}
      {view.controls.length > 0 && <ControlButtons controls={view.controls} hintLabel={view.hintLabel} onControl={onControl} spread />}
    </div>
  );
}
