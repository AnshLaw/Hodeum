import { useRef, useState, type CSSProperties } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { HodeRuntime } from "../../features/hode/runtime";
import { useHodeState } from "../../features/hode/use-hode";
import { matchGoal } from "../../task-packs/match";
import { GoalForm } from "./GoalForm";
import { useAutoDismiss, useControlHandler, useHitRect, useNotchHover } from "./hooks";
import { NotchBar, NotchContent } from "./NotchParts";
import { NOTCH_IDLE_HOVER_WIDTH, NOTCH_WIDTHS, isExpanded, notchView } from "./notch-view";
import "./notch.css";

export interface NotchProps {
  runtime: HodeRuntime;
  bus: Bus;
  shell: NativeShell;
  packs: TaskPack[];
  /** Shown while idle when something degraded at boot (e.g. the skill database). */
  bootNotice?: string;
}

export function Notch({ runtime, bus, shell, packs, bootNotice }: NotchProps) {
  const view = notchView(useHodeState(runtime));
  const pillRef = useRef<HTMLElement>(null);
  const [muted, setMuted] = useState(false);
  const hovered = useNotchHover(pillRef, shell);
  const onControl = useControlHandler(runtime, bus);
  useHitRect(pillRef, shell);
  useAutoDismiss(view.mode === "success", runtime);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    runtime.setMuted(next);
  };
  const submitGoal = (goal: string) => runtime.dispatch({ type: "GOAL_SUBMITTED", goal, pack: matchGoal(goal, packs) });
  const expanded = isExpanded(view);
  const style = {
    "--notch-width": `${NOTCH_WIDTHS[view.size]}px`,
    "--notch-hover-width": `${NOTCH_IDLE_HOVER_WIDTH}px`,
  } as CSSProperties;

  return (
    <div className="notch-stage">
      <section ref={pillRef} className={`notch notch--${view.size} notch--${view.mode}${hovered ? " notch--hovered" : ""}`} style={style} aria-label={COPY.idleTitle}>
        <NotchBar view={view} expanded={expanded} muted={muted} onToggleMute={toggleMute} onControl={onControl} />
        <div aria-live="polite">
          {view.mode === "goal" ? (
            <GoalForm packs={packs} shell={shell} notice={view.detail} onSubmit={submitGoal} onClose={() => onControl("dismiss")} />
          ) : (
            <NotchContent view={view} expanded={expanded} fallbackDetail={bootNotice} onControl={onControl} />
          )}
        </div>
      </section>
    </div>
  );
}
