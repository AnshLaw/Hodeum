import type { Ref } from "react";
import { COPY } from "../../lib/copy";
import { HodeyFace } from "../hodey/HodeyFace";
import { CheckIcon, CrosshairIcon, ExpandIcon, IconButton, MoreIcon, MutedIcon, VolumeIcon } from "../shared/icons";
import { DockMenu } from "./DockMenu";
import { GoalForm } from "./GoalForm";
import { Grip, LocalBadge, MicButton, NotchContent, PrivacyDots } from "./NotchParts";
import type { StepItem } from "./notch-view";
import type { SurfaceProps } from "./surface";

const HODEY_TAB_SIZE = 42;
const HODEY_BAR_SIZE = 40;

function StepList({ steps }: { steps: StepItem[] }) {
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

function IdleStart({ onControl, notice }: Pick<SurfaceProps, "onControl"> & { notice?: string }) {
  return (
    <div className="notch__content sidebar__idle">
      <p className="notch__title">{COPY.goalPrompt}</p>
      {notice && <p className="notch__detail">{notice}</p>}
      <div className="notch__actions">
        <button type="button" className="btn btn--primary" onClick={() => onControl("start")}>
          {COPY.startHode}
        </button>
        <button type="button" className="btn" onClick={() => onControl("point")}>
          <CrosshairIcon /> {COPY.pointAndAsk}
        </button>
      </div>
    </div>
  );
}

function SidebarBody(props: SurfaceProps) {
  const { view, menuOpen, dock, onControl } = props;
  if (menuOpen) return <DockMenu prefs={dock.prefs} vision={props.vision} onChange={dock.update} onHide={() => dock.update({ visibility: "hidden" })} />;
  if (view.mode === "goal") {
    return <GoalForm packs={props.packs} shell={props.shell} notice={view.detail} onSubmit={props.onSubmitGoal} onClose={() => onControl("dismiss")} />;
  }
  if (view.mode === "idle") return <IdleStart onControl={onControl} notice={view.detail ?? props.bootNotice} />;
  return (
    <>
      <NotchContent view={view} expanded onControl={onControl} />
      {props.steps.length > 0 && <StepList steps={props.steps} />}
    </>
  );
}

/** Side dock: a slim tab when idle, a full-height panel while a Hode runs. */
export function Sidebar(props: SurfaceProps & { side: "left" | "right"; surfaceRef: Ref<HTMLElement> }) {
  const { side, view, hovered, menuOpen, revealed, muted, surfaceRef } = props;
  const collapsed = view.mode === "idle" && !hovered && !menuOpen;
  const classes = ["sidebar", `sidebar--${side}`, collapsed ? "sidebar--collapsed" : "", view.mode !== "idle" ? "sidebar--active" : "", revealed ? "" : "sidebar--tucked"];
  return (
    <div className={`sidebar-stage sidebar-stage--${side}`}>
      <aside ref={surfaceRef} className={classes.filter(Boolean).join(" ")} aria-label={COPY.idleTitle}>
        {collapsed ? (
          <Grip onGrip={props.onGrip}>
            <span className="sidebar__tab">
              <HodeyFace mood={props.mood} size={HODEY_TAB_SIZE} />
              <span className="sidebar__tab-label">{COPY.idleTitle}</span>
              <PrivacyDots activity={props.activity} />
              <span className="sidebar__tab-dot" aria-label={COPY.local} />
            </span>
          </Grip>
        ) : (
          <>
            <header className="notch__bar sidebar__bar">
              {view.busy && <span className="notch__scan" aria-hidden="true" />}
              <Grip onGrip={props.onGrip}>
                <HodeyFace mood={props.mood} size={HODEY_BAR_SIZE} />
                <span className="notch__bar-title">{menuOpen ? COPY.hodeySettings : (view.eyebrow ?? COPY.idleTitle)}</span>
              </Grip>
              <span className="notch__spacer" />
              <MicButton status={props.micStatus} onToggle={props.onToggleMic} />
              {view.mode !== "idle" && (
                <IconButton label={muted ? COPY.unmute : COPY.mute} onClick={props.onToggleMute}>
                  {muted ? <MutedIcon /> : <VolumeIcon />}
                </IconButton>
              )}
              <IconButton label={COPY.openApp} onClick={props.onOpenApp}>
                <ExpandIcon />
              </IconButton>
              <IconButton label={COPY.hodeySettings} onClick={props.onToggleMenu} pressed={menuOpen}>
                <MoreIcon />
              </IconButton>
              <PrivacyDots activity={props.activity} />
              <LocalBadge />
            </header>
            {props.toast && <p className="notch__toast" role="status">{props.toast}</p>}
            <div className="sidebar__body" aria-live="polite">
              <SidebarBody {...props} />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
