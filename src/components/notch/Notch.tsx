import { useRef, useState, type CSSProperties, type Ref } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { HodeRuntime } from "../../features/hode/runtime";
import { useHodeState } from "../../features/hode/use-hode";
import { matchGoal } from "../../task-packs/match";
import { DockMenu } from "./DockMenu";
import { GoalForm } from "./GoalForm";
import { useAutoDismiss, useControlHandler, useCoveringTarget, useHitRect, useNotchHover } from "./hooks";
import { NotchBar, NotchContent } from "./NotchParts";
import { Sidebar } from "./Sidebar";
import type { SurfaceProps } from "./surface";
import { useDock, useRevealed } from "./use-dock";
import { NOTCH_IDLE_HOVER_WIDTH, NOTCH_WIDTHS, isExpanded, notchView, stepItems } from "./notch-view";
import { hodeyMood } from "../hodey/mood";
import "../hodey/hodey-face.css";
import "./notch.css";

export interface NotchProps {
  runtime: HodeRuntime;
  bus: Bus;
  shell: NativeShell;
  packs: TaskPack[];
  /** Shown while idle when something degraded at boot (e.g. the skill database). */
  bootNotice?: string;
}

function TopNotch(props: SurfaceProps & { surfaceRef: Ref<HTMLElement>; covering: boolean }) {
  const { menuOpen, hovered, revealed, dock, onControl } = props;
  // Step aside to a slim bar while the highlighted control sits under the card; hovering brings it back.
  const peek = props.covering && !hovered && !menuOpen && props.view.mode === "guidance";
  const view = peek ? { ...props.view, controls: [], progress: props.view.progress } : props.view;
  const expanded = isExpanded(view) && !peek;
  const width = menuOpen ? NOTCH_WIDTHS.lesson : peek ? NOTCH_WIDTHS.compact : NOTCH_WIDTHS[view.size];
  const style = { "--notch-width": `${width}px`, "--notch-hover-width": `${NOTCH_IDLE_HOVER_WIDTH}px` } as CSSProperties;
  const classes = ["notch", `notch--${peek ? "compact" : view.size}`, `notch--${view.mode}`, hovered ? "notch--hovered" : "", revealed ? "" : "notch--tucked", peek ? "notch--peek" : ""];
  let body;
  if (menuOpen) body = <DockMenu prefs={dock.prefs} onChange={dock.update} onHide={() => dock.update({ visibility: "hidden" })} />;
  else if (view.mode === "goal") body = <GoalForm packs={props.packs} shell={props.shell} notice={view.detail} onSubmit={props.onSubmitGoal} onClose={() => onControl("dismiss")} />;
  else if (peek) body = null;
  else body = <NotchContent view={view} expanded={expanded} fallbackDetail={props.bootNotice} onControl={onControl} />;
  return (
    <div className="notch-stage">
      <section ref={props.surfaceRef} className={classes.filter(Boolean).join(" ")} style={style} aria-label={COPY.idleTitle}>
        <NotchBar view={view} mood={props.mood} expanded={expanded} muted={props.muted} menuOpen={menuOpen} onToggleMute={props.onToggleMute} onToggleMenu={props.onToggleMenu} onControl={onControl} onGrip={props.onGrip} />
        <div aria-live="polite">{body}</div>
      </section>
    </div>
  );
}

/** Hodey's surface: a top-centre notch or a side sidebar, draggable between them, with auto-hide. */
export function Notch({ runtime, bus, shell, packs, bootNotice }: NotchProps) {
  const state = useHodeState(runtime);
  const view = notchView(state);
  const surfaceRef = useRef<HTMLElement>(null);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dock = useDock(shell, state.phase);
  const layoutKey = dock.prefs.dock;
  const hovered = useNotchHover(surfaceRef, shell, layoutKey);
  const revealed = useRevealed(dock.prefs, hovered || menuOpen, state.phase);
  const onControl = useControlHandler(runtime, bus);
  useHitRect(surfaceRef, shell, `${layoutKey}:${revealed}`);
  useAutoDismiss(view.mode === "success", runtime);
  const covering = useCoveringTarget(bus, shell, surfaceRef, dock.prefs.dock === "top");

  const props: SurfaceProps = {
    view,
    mood: hodeyMood(state, hovered),
    steps: stepItems(state),
    hovered,
    revealed,
    muted,
    menuOpen,
    dock,
    packs,
    shell,
    bootNotice,
    onControl,
    onToggleMute: () => {
      runtime.setMuted(!muted);
      setMuted(!muted);
    },
    onToggleMenu: () => setMenuOpen((open) => !open),
    onGrip: () => {
      shell.beginNotchDrag().catch(reportError("Couldn't start dragging Hodey"));
    },
    onSubmitGoal: (goal) => runtime.dispatch({ type: "GOAL_SUBMITTED", goal, pack: matchGoal(goal, packs) }),
  };
  if (dock.prefs.dock === "top") return <TopNotch {...props} surfaceRef={surfaceRef} covering={covering} />;
  return <Sidebar {...props} side={dock.prefs.dock} surfaceRef={surfaceRef} />;
}
