import { useRef, type Ref } from "react";
import type { Size } from "../../lib/types";
import { COPY } from "../../lib/copy";
import { HodeyFace } from "../hodey/HodeyFace";
import { CheckIcon, CrosshairIcon, ExpandIcon, IconButton, MoreIcon, MutedIcon, VolumeIcon } from "../shared/icons";
import { SurfaceMenu } from "./DockMenu";
import { SkillsPanel, successExtra } from "./SkillsPanel";
import { GoalForm } from "./GoalForm";
import { Grip, LocalBadge, MenuCaret, MicButton, NotchContent, PrivacyDots, StepList } from "./NotchParts";
import { openVoiceMenu } from "./VoiceMenu";
import type { SurfaceProps } from "./surface";
import { PhonePanel } from "./PhonePanel";
import { sidebarPanelOpen } from "./sidebar-view";
import { usePhoneScreen } from "./use-phone";

const HODEY_TAB_SIZE = 42;
const HODEY_BAR_SIZE = 40;
const HODEY_BUSY_SIZE = 112;

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

/** With the iPhone mirror open, the side panel stacks the phone above Hodey's guidance. */
function SidebarContent(props: SurfaceProps & { phoneScreen?: Size }) {
  if (!props.phoneOpen || !props.phone || props.menuOpen || props.skills?.open) return <SidebarBody {...props} />;
  return (
    <PhonePanel mirror={props.phone} bus={props.bus} stacked screen={props.phoneScreen}>
      <SidebarBody {...props} />
    </PhonePanel>
  );
}

function SidebarBody(props: SurfaceProps) {
  const { view, menuOpen, skills, onControl } = props;
  const voiceMenu = openVoiceMenu(props);
  if (voiceMenu) return voiceMenu;
  if (menuOpen) return <SurfaceMenu {...props} />;
  if (skills?.open) return <SkillsPanel skills={skills} />;
  if (view.mode === "goal") {
    return <GoalForm packs={props.packs} shell={props.shell} notice={view.detail} defaultMode={props.defaultMode} defaultAgentStyle={props.defaultAgentStyle} onSubmit={props.onSubmitGoal} onClose={() => onControl("dismiss")} />;
  }
  if (view.mode === "idle") return <IdleStart onControl={onControl} notice={view.detail ?? props.bootNotice} />;
  if (view.busy) {
    return (
      <div className="sidebar__busy" role="status">
        <span className="notch__orb-ring sidebar__busy-ring" aria-hidden="true" />
        <HodeyFace mood={props.mood} size={HODEY_BUSY_SIZE} />
        <p className="notch__detail">{view.title}</p>
      </div>
    );
  }
  return (
    <>
      {/* The panel has its own step list below; don't repeat it inside the card, but keep its toggle lit. */}
      <NotchContent view={{ ...view, steps: undefined }} expanded onControl={onControl} extra={successExtra(props)} active={view.steps ? ["all_steps"] : []} onChoice={props.onAnswer} />
      {props.steps.length > 0 && <StepList steps={props.steps} />}
    </>
  );
}

/** Side dock: a slim tab when idle, a full-height panel while a Hode runs (or always, as a pinned copilot). */
export function Sidebar(props: SurfaceProps & { side: "left" | "right"; surfaceRef: Ref<HTMLElement> }) {
  const { side, view, hovered, menuOpen, revealed, muted, surfaceRef } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneScreen = usePhoneScreen(props.phone, stageRef, "stacked");
  const { sidebar: style, visibility } = props.dock.prefs;
  const panelOpen = sidebarPanelOpen({ mode: view.mode, listening: props.micStatus === "listening", style, visibility, phoneOpen: props.phoneOpen === true });
  const skillsOpen = props.skills?.open === true;
  const collapsed = !panelOpen && !hovered && !menuOpen && !skillsOpen;
  const classes = ["sidebar", `sidebar--${side}`, `sidebar--${style}`, collapsed ? "sidebar--collapsed" : "", panelOpen ? "sidebar--active" : "", revealed ? "" : "sidebar--tucked"];
  return (
    <div ref={stageRef} className={`sidebar-stage sidebar-stage--${side}`}>
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
                <span className="notch__bar-title">{menuOpen ? COPY.hodeySettings : skillsOpen ? COPY.yourSkills : (view.eyebrow ?? COPY.idleTitle)}</span>
              </Grip>
              <span className="notch__spacer" />
              <MicButton status={props.micStatus} onToggle={props.onToggleMic} />
              {props.voiceSetup && <MenuCaret label={COPY.micMenu} open={props.voiceMenu === "mic"} onClick={() => props.onVoiceMenu?.("mic")} />}
              {view.mode !== "idle" && (
                <>
                  <IconButton label={muted ? COPY.unmute : COPY.mute} onClick={props.onToggleMute}>
                    {muted ? <MutedIcon /> : <VolumeIcon />}
                  </IconButton>
                  {props.voiceSetup && <MenuCaret label={COPY.speakerMenu} open={props.voiceMenu === "speaker"} onClick={() => props.onVoiceMenu?.("speaker")} />}
                </>
              )}
              <IconButton label={COPY.openApp} onClick={props.onOpenApp}>
                <ExpandIcon />
              </IconButton>
              <IconButton label={COPY.hodeySettings} onClick={props.onToggleMenu} pressed={menuOpen}>
                <MoreIcon />
              </IconButton>
              <PrivacyDots activity={props.activity} />
              <LocalBadge onOpen={props.cloudSetup ? () => props.onVoiceMenu?.("cloud") : undefined} open={props.voiceMenu === "cloud"} />
            </header>
            {props.toast && <p className="notch__toast" role="status">{props.toast}</p>}
            {props.micStatus === "listening" && (
              <p className="notch__heard" aria-live="polite">
                {props.heard ? `“${props.heard}”` : COPY.listening}
              </p>
            )}
            <div className="sidebar__body" aria-live="polite">
              <SidebarContent {...props} phoneScreen={phoneScreen} />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
