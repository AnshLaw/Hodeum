import { useEffect, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
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
import type { VisionStatus, VisionStatusSource } from "../../providers/vision/types";
import type { ActivityState, ActivityTracker } from "../../lib/activity";
import type { SpeechInput, SpeechInputStatus } from "../../providers/speech/speech-input";
import { PrivacyDots } from "./NotchParts";
import "../hodey/hodey-face.css";
import "./notch.css";

export interface NotchProps {
  runtime: HodeRuntime;
  bus: Bus;
  shell: NativeShell;
  packs: TaskPack[];
  /** Shown while idle when something degraded at boot (e.g. the skill database). */
  bootNotice?: string;
  /** The local vision model's status (desktop app only). */
  vision?: VisionStatusSource;
  activity: ActivityTracker;
  speech: SpeechInput;
}

const TOAST_MS = 4000;

function useActivity(tracker: ActivityTracker): ActivityState {
  const [state, setState] = useState(tracker.current());
  useEffect(() => tracker.subscribe(setState), [tracker]);
  return state;
}

function useSpeechStatus(speech: SpeechInput): SpeechInputStatus {
  const [status, setStatus] = useState(speech.status());
  useEffect(() => speech.onStatus(setStatus), [speech]);
  return status;
}

function useToast(): [string | undefined, (message: string) => void] {
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, setToast];
}

function useVisionStatus(source?: VisionStatusSource): VisionStatus | undefined {
  const [status, setStatus] = useState(source?.current());
  useEffect(() => {
    if (!source) return;
    setStatus(source.current());
    return source.subscribe(setStatus);
  }, [source]);
  return status;
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
  if (menuOpen) body = <DockMenu prefs={dock.prefs} vision={props.vision} onChange={dock.update} onHide={() => dock.update({ visibility: "hidden" })} />;
  else if (view.mode === "goal") body = <GoalForm packs={props.packs} shell={props.shell} notice={view.detail} onSubmit={props.onSubmitGoal} onClose={() => onControl("dismiss")} />;
  else if (peek) body = null;
  else body = <NotchContent view={view} expanded={expanded} fallbackDetail={props.bootNotice} onControl={onControl} />;
  return (
    <div className="notch-stage">
      <section ref={props.surfaceRef} className={classes.filter(Boolean).join(" ")} style={style} aria-label={COPY.idleTitle}>
        <NotchBar view={view} mood={props.mood} expanded={expanded} muted={props.muted} menuOpen={menuOpen} onToggleMute={props.onToggleMute} onToggleMenu={props.onToggleMenu} onControl={onControl} onGrip={props.onGrip} activity={props.activity} micStatus={props.micStatus} onToggleMic={props.onToggleMic} onOpenApp={props.onOpenApp} />
        {props.toast && <p className="notch__toast" role="status">{props.toast}</p>}
        <div aria-live="polite">{body}</div>
        {!revealed && <PrivacyDots activity={props.activity} className="privacy-dots--sliver" />}
      </section>
    </div>
  );
}

/** Mic toggling (with a toast when it can't start) and opening the app from the notch's rect. */
function useNotchActions(speech: SpeechInput, shell: NativeShell, surfaceRef: RefObject<HTMLElement | null>) {
  const micStatus = useSpeechStatus(speech);
  const [toast, showToast] = useToast();
  const toggleMic = () => {
    if (micStatus === "unavailable") return showToast(speech.unavailableReason() ?? COPY.voiceNotInstalled);
    const change = micStatus === "listening" ? speech.stop() : speech.start();
    change.catch((error) => {
      console.error("Couldn't change the microphone", error);
      showToast(error instanceof Error ? error.message : String(error));
    });
  };
  const openApp = () => {
    const box = surfaceRef.current?.getBoundingClientRect();
    const from = box ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: 0, y: 0, width: 0, height: 0 };
    shell.openApp(from).catch(reportError("Couldn't open the Hodeum app"));
  };
  return { micStatus, toast, toggleMic, openApp };
}

/** Hodey's surface: a top-centre notch or a side sidebar, draggable between them, with auto-hide. */
export function Notch({ runtime, bus, shell, packs, bootNotice, vision, activity: tracker, speech }: NotchProps) {
  const state = useHodeState(runtime);
  const visionStatus = useVisionStatus(vision);
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
  const activity = useActivity(tracker);
  const { micStatus, toast, toggleMic, openApp } = useNotchActions(speech, shell, surfaceRef);

  const props: SurfaceProps = {
    view,
    mood: micStatus === "listening" ? "listening" : hodeyMood(state, hovered),
    steps: stepItems(state),
    hovered,
    revealed,
    muted,
    menuOpen,
    dock,
    packs,
    shell,
    bootNotice,
    vision: visionStatus,
    onControl,
    onToggleMute: () => {
      runtime.setMuted(!muted);
      setMuted(!muted);
    },
    onToggleMenu: () => setMenuOpen((open) => !open),
    onGrip: () => {
      shell.beginNotchDrag().catch(reportError("Couldn't start dragging Hodey"));
    },
    activity,
    micStatus,
    toast,
    onToggleMic: toggleMic,
    onOpenApp: openApp,
    onSubmitGoal: (goal) =>
      runtime.dispatch({ type: "GOAL_SUBMITTED", goal, pack: matchGoal(goal, packs), openAllowed: visionStatus?.state === "ready" }),
  };
  if (dock.prefs.dock === "top") return <TopNotch {...props} surfaceRef={surfaceRef} covering={covering} />;
  return <Sidebar {...props} side={dock.prefs.dock} surfaceRef={surfaceRef} />;
}
