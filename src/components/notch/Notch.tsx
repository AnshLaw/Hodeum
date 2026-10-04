import { useEffect, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { TaskPack } from "../../lib/types";
import type { HodeRuntime } from "../../features/hode/runtime";
import { goalEvent } from "../../features/hode/bridge";
import { useHodeState } from "../../features/hode/use-hode";
import { DockMenu } from "./DockMenu";
import { GoalForm } from "./GoalForm";
import { useAutoDismiss, useControlHandler, useCoveringTarget, useHitRect, useNotchHover, useSettled } from "./hooks";
import { NotchBar, NotchContent } from "./NotchParts";
import { Sidebar } from "./Sidebar";
import type { SurfaceProps } from "./surface";
import { useDock, useRevealed } from "./use-dock";
import { NOTCH_IDLE_HOVER_WIDTH, NOTCH_WIDTHS, islandSize, notchView, stepItems, type NotchSize, type NotchView } from "./notch-view";
import { HodeyFace } from "../hodey/HodeyFace";
import { hodeyMood, type HodeyMood } from "../hodey/mood";
import type { VisionStatus, VisionStatusSource } from "../../providers/vision/types";
import type { ActivityState, ActivityTracker } from "../../lib/activity";
import type { SpeechInput, SpeechInputStatus } from "../../providers/speech/speech-input";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import { PhonePanel } from "./PhonePanel";
import { usePhoneControls } from "./use-phone";
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
  /** The iPhone mirror (desktop app only). */
  phone?: PhoneMirror;
}

const TOAST_MS = 4000;
/** How long a finished sentence stays on screen after the learner stops talking. */
const HEARD_LINGER_MS = 1500;

/** What Hodey is hearing right now: live words while the learner talks, then the final sentence briefly. */
function useHeard(speech: SpeechInput, listening: boolean): string | undefined {
  const [heard, setHeard] = useState<string>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = speech.onTranscript((text, final) => {
      clearTimeout(timer);
      setHeard(text);
      if (final) timer = setTimeout(() => setHeard(undefined), HEARD_LINGER_MS);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [speech]);
  useEffect(() => {
    if (!listening) setHeard(undefined);
  }, [listening]);
  return heard;
}

/** While listening, a line under the bar shows the words as Hodey hears them. */
function HeardLine({ heard }: { heard?: string }) {
  return (
    <p className="notch__heard" aria-live="polite">
      {heard ? `“${heard}”` : COPY.listening}
    </p>
  );
}

function useActivity(tracker: ActivityTracker): ActivityState {
  const [state, setState] = useState(tracker.current());
  useEffect(() => {
    const off = tracker.subscribe(setState);
    setState(tracker.current());
    return off;
  }, [tracker]);
  return state;
}

function useSpeechStatus(speech: SpeechInput): SpeechInputStatus {
  const [status, setStatus] = useState(speech.status());
  useEffect(() => {
    const off = speech.onStatus(setStatus);
    // The voice engine may have reported in between the first render and this subscription.
    setStatus(speech.status());
    return off;
  }, [speech]);
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

/** Hodey has to be busy this long before the notch shrinks to an orb, so quick reads don't flicker. */
const ORB_DELAY_MS = 180;
const ORB_FACE_SIZE = 40;
const EXPANDED_SIZES: NotchSize[] = ["guidance", "lesson", "success", "phone"];

/** Looking or thinking: just Hodey, in its current mood, with a sweeping ring. */
function Orb({ mood, label, activity }: { mood: HodeyMood; label: string; activity: ActivityState }) {
  return (
    <div className="notch__orb" role="status" aria-label={label}>
      <span className="notch__orb-ring" aria-hidden="true" />
      <HodeyFace mood={mood} size={ORB_FACE_SIZE} />
      <PrivacyDots activity={activity} className="privacy-dots--orb" />
    </div>
  );
}

function topBody(props: SurfaceProps, view: NotchView, size: NotchSize, peek: boolean) {
  const { menuOpen, dock, onControl } = props;
  if (menuOpen) return <DockMenu prefs={dock.prefs} vision={props.vision} mode={props.hodeActive ? props.hodeMode : undefined} onModeChange={props.onSetMode} onChange={dock.update} onHide={() => dock.update({ visibility: "hidden" })} phoneOpen={props.phoneOpen} onTogglePhone={props.onTogglePhone} />;
  if (view.mode === "goal") return <GoalForm packs={props.packs} shell={props.shell} notice={view.detail} defaultMode={props.defaultMode} onSubmit={props.onSubmitGoal} onClose={() => onControl("dismiss")} />;
  if (peek) return null;
  return <NotchContent view={view} expanded={EXPANDED_SIZES.includes(size)} fallbackDetail={props.bootNotice} onControl={onControl} />;
}

/** The dynamic island: one surface that morphs between pill, orb, bar and card as Hodey works. */
function TopNotch(props: SurfaceProps & { surfaceRef: Ref<HTMLElement>; covering: boolean }) {
  const { menuOpen, hovered, revealed } = props;
  const settled = useSettled(props.view.size === "orb", ORB_DELAY_MS);
  // Step aside to a slim bar while the highlighted control sits under the card; hovering brings it back.
  const peek = props.covering && !hovered && !menuOpen && props.view.mode === "guidance";
  const listening = props.micStatus === "listening";
  const size = islandSize(props.view, { settled, hovered, menuOpen, peek, listening, phone: props.phoneOpen === true });
  const view = peek ? { ...props.view, controls: [] } : props.view;
  const style = { "--notch-width": `${NOTCH_WIDTHS[size]}px`, "--notch-hover-width": `${NOTCH_IDLE_HOVER_WIDTH}px` } as CSSProperties;
  const classes = ["notch", `notch--${size}`, `notch--${view.mode}`, hovered ? "notch--hovered" : "", revealed ? "" : "notch--tucked", peek ? "notch--peek" : ""];
  return (
    <div className="notch-stage">
      <section ref={props.surfaceRef} className={classes.filter(Boolean).join(" ")} style={style} aria-label={COPY.idleTitle}>
        {size === "orb" ? (
          <Orb mood={props.mood} label={view.title} activity={props.activity} />
        ) : (
          <>
            <NotchBar view={view} mood={props.mood} expanded={EXPANDED_SIZES.includes(size)} muted={props.muted} menuOpen={menuOpen} onToggleMute={props.onToggleMute} onToggleMenu={props.onToggleMenu} onControl={props.onControl} onGrip={props.onGrip} activity={props.activity} micStatus={props.micStatus} onToggleMic={props.onToggleMic} onOpenApp={props.onOpenApp} />
            {props.toast && <p className="notch__toast" role="status">{props.toast}</p>}
            {listening && <HeardLine heard={props.heard} />}
            <div aria-live="polite">
              {size === "phone" && props.phone ? (
                <PhonePanel mirror={props.phone} bus={props.bus}>
                  {topBody(props, view, size, peek)}
                </PhonePanel>
              ) : (
                topBody(props, view, size, peek)
              )}
            </div>
          </>
        )}
        {!revealed && <PrivacyDots activity={props.activity} className="privacy-dots--sliver" />}
      </section>
    </div>
  );
}

/** Mic toggling (with a toast when it can't start) and opening the app from the notch's rect. */
function useNotchActions(speech: SpeechInput, shell: NativeShell, surfaceRef: RefObject<HTMLElement | null>) {
  const micStatus = useSpeechStatus(speech);
  const [toast, showToast] = useToast();
  const heard = useHeard(speech, micStatus === "listening");
  useEffect(() => speech.onError?.(showToast), [speech, showToast]);
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
  return { micStatus, toast, heard, toggleMic, openApp };
}

/** Hodey's surface: a top-centre notch or a side sidebar, draggable between them, with auto-hide. */
export function Notch({ runtime, bus, shell, packs, bootNotice, vision, activity: tracker, speech, phone }: NotchProps) {
  const state = useHodeState(runtime);
  const visionStatus = useVisionStatus(vision);
  const view = notchView(state);
  const surfaceRef = useRef<HTMLElement>(null);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dock = useDock(shell, state.phase, bus);
  const layoutKey = dock.prefs.dock;
  const hovered = useNotchHover(surfaceRef, shell, layoutKey);
  const revealed = useRevealed(dock.prefs, hovered || menuOpen, state.phase);
  const onControl = useControlHandler(runtime, bus);
  useHitRect(surfaceRef, shell, `${layoutKey}:${revealed}`);
  useAutoDismiss(view.mode === "success", runtime);
  const covering = useCoveringTarget(bus, shell, surfaceRef, dock.prefs.dock === "top");
  const activity = useActivity(tracker);
  const { micStatus, toast, heard, toggleMic, openApp } = useNotchActions(speech, shell, surfaceRef);
  const { phoneOpen, onTogglePhone } = usePhoneControls(phone, state, () => setMenuOpen(false));

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
    heard,
    onToggleMic: toggleMic,
    onOpenApp: () => {
      // The notch grows into the app, then gets out of its way: goal entry continues on the app's home page.
      openApp();
      setMenuOpen(false);
      if (state.phase === "goal_entry") runtime.dispatch({ type: "DISMISS" });
    },
    onSubmitGoal: (goal, mode) => runtime.dispatch(goalEvent(goal, packs, visionStatus?.state === "ready", mode)),
    hodeMode: state.mode,
    defaultMode: runtime.getDefaultMode(),
    hodeActive: state.phase !== "idle" && state.phase !== "goal_entry",
    onSetMode: (mode) => runtime.dispatch({ type: "SET_MODE", mode }),
    bus,
    phone,
    phoneOpen,
    onTogglePhone,
  };
  if (dock.prefs.dock === "top") return <TopNotch {...props} surfaceRef={surfaceRef} covering={covering} />;
  return <Sidebar {...props} side={dock.prefs.dock} surfaceRef={surfaceRef} />;
}
