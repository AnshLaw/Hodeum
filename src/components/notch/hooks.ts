import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { HodeRuntime } from "../../features/hode/runtime";
import type { OverlayPrimitive } from "../../lib/types";
import type { Dock } from "../../features/dock/dock";
import { coversTarget, guidanceFootprint, notchScreenRect, withinWindow } from "./footprint";
import { createHoverGate, hoverGraceMs } from "./hover-gate";
import type { NotchControl } from "./notch-view";

/** Long enough to read what moved and the next suggestion; hovering holds it longer. */
const SUCCESS_DISPLAY_MS = 5000;
/** An answer stays this long after it's been said, then folds back to what the learner was doing. */
export const ANSWER_LINGER_MS = 6000;
/** The surface's slide transitions are well under this; the hit area stops following it every frame after it. */
const SLIDE_FOLLOW_MAX_MS = 1000;

/** Tells the overlay where the surface is (physical screen px), so arrows and labels keep out from under it. */
function broadcastRect(element: HTMLElement, shell: NativeShell, bus: Bus): void {
  const box = element.getBoundingClientRect();
  // The surface's container spans the notch window (Tauri) or the stage's desktop: its origin is the window's.
  const base = element.parentElement?.getBoundingClientRect() ?? { x: 0, y: 0 };
  const local = { x: box.x - base.x, y: box.y - base.y, width: box.width, height: box.height };
  shell
    .notchOrigin()
    .then((origin) => bus.emit("notch:rect", { rect: notchScreenRect(local, origin) }))
    .catch(reportError("Couldn't tell the overlay where the notch is"));
}

/**
 * Keeps the native hit-test (and the overlay's idea of where the notch is) in sync with the surface
 * as it animates, so only it captures clicks. `layoutKey` changes when the surface element is swapped
 * (top notch <-> sidebar).
 */
export function useHitRect(ref: RefObject<HTMLElement | null>, shell: NativeShell, bus: Bus, layoutKey: string): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Includes transforms, so a tucked-away (auto-hidden) surface reports just the orb, where it shows.
        const { x, y, width, height } = element.getBoundingClientRect();
        const hit = withinWindow({ x, y, width, height }, { width: window.innerWidth, height: window.innerHeight });
        shell.setNotchHitRect(hit).catch(reportError("Couldn't update the notch hit area"));
        broadcastRect(element, shell, bus);
      });
    };
    const offRequest = bus.on("notch:rect-request", report);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    // Folding into the orb sinks the surface into the screen edge (a move, which ResizeObserver doesn't see): follow it
    // every frame, or the hit area lags behind the surface and a cursor over where it was keeps it out.
    // Only the surface's own transitions: its children's (the orb, a card fading) bubble here too, and once kept this
    // loop running every frame. Capped, in case a transitionend never comes (an interrupted or cancelled animation).
    let sliding = 0;
    let slideUntil = 0;
    const follow = () => {
      report();
      sliding = performance.now() < slideUntil ? requestAnimationFrame(follow) : 0;
    };
    const startSliding = (event: TransitionEvent) => {
      if (event.target !== element) return;
      slideUntil = performance.now() + SLIDE_FOLLOW_MAX_MS;
      cancelAnimationFrame(sliding);
      sliding = requestAnimationFrame(follow);
    };
    const stopSliding = (event: TransitionEvent) => {
      if (event.target !== element) return;
      cancelAnimationFrame(sliding);
      sliding = 0;
      report();
    };
    element.addEventListener("transitionrun", startSliding);
    element.addEventListener("transitionend", stopSliding);
    element.addEventListener("transitioncancel", stopSliding);
    // The window growing or shrinking around the iPhone mirror moves the centred surface without resizing it.
    window.addEventListener("resize", report);
    report();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(sliding);
      element.removeEventListener("transitionrun", startSliding);
      element.removeEventListener("transitionend", stopSliding);
      element.removeEventListener("transitioncancel", stopSliding);
      window.removeEventListener("resize", report);
      offRequest();
      cancelAnimationFrame(frame);
    };
  }, [ref, shell, bus, layoutKey]);
}

/**
 * Hover from both DOM pointer events (browser) and the native hit-test (Tauri), because a window
 * that ignores cursor events never receives pointerleave. A side dock grows from a tab into a panel
 * under the cursor, so leaving it waits out a grace period (see `hoverGraceMs`).
 */
export function useNotchHover(ref: RefObject<HTMLElement | null>, shell: NativeShell, dock: Dock): boolean {
  const [hovered, setHovered] = useState(false);
  // A new gate (after re-docking) starts from the hover React still shows, or its first leave would be lost.
  const current = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onChange = (next: boolean) => {
      current.current = next;
      setHovered(next);
    };
    const gate = createHoverGate(onChange, hoverGraceMs(dock), current.current);
    const enter = () => gate.set(true);
    const leave = () => gate.set(false);
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    const stopNative = shell.onNotchHover(gate.set);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      stopNative();
      gate.dispose();
    };
  }, [ref, shell, dock]);
  return hovered;
}

/**
 * Closes the notch's open menu or panel on a press anywhere else, like any popover. The notch never takes
 * focus and is click-through outside its surface, so the native side reports such presses; the DOM listener
 * catches presses inside the notch window but off its surface.
 */
export function useOutsidePress(ref: RefObject<HTMLElement | null>, shell: NativeShell, active: boolean, onOutside: () => void): void {
  const latest = useRef(onOutside);
  latest.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const close = () => latest.current();
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    const stop = shell.onNotchOutsidePress(close);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      stop();
    };
  }, [ref, shell, active]);
}

/** True once `value` has held for `ms`; false the moment it doesn't. Keeps brief states from flickering. */
export function useSettled(value: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!value) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return value && settled;
}

/**
 * Long enough for the click that reached for the tucked orb to land (the notch opens on hover, a moment before it);
 * spent before the opened notch's buttons have finished appearing and the learner could aim at one.
 */
const WAKE_MS = 500;

/**
 * True for a moment after the notch comes out of the tucked orb. Hovering opens it, so a click aimed at the orb lands
 * on whatever opened in its place (Start a Hode, End Hode): the opened notch's controls ignore it meanwhile.
 */
export function useWaking(revealed: boolean): boolean {
  return revealed && !useSettled(revealed, WAKE_MS);
}

/** True for `ms` after the latest `trigger()`, then false again. */
export function usePulse(ms: number): [boolean, () => void] {
  const [triggers, setTriggers] = useState(0);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (triggers === 0) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [triggers, ms]);
  const trigger = useCallback(() => setTriggers((count) => count + 1), []);
  return [on, trigger];
}

export function useAutoDismiss(active: boolean, runtime: HodeRuntime, ms = SUCCESS_DISPLAY_MS): void {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => runtime.dispatch({ type: "DISMISS" }), ms);
    return () => clearTimeout(timer);
  }, [active, runtime, ms]);
}

export function useControlHandler(runtime: HodeRuntime, bus: Bus): (control: NotchControl) => void {
  return useCallback(
    (control: NotchControl) => {
      const dispatch = runtime.dispatch;
      switch (control) {
        case "start":
          return dispatch({ type: "START_HODE" });
        case "point":
          return bus.emit("annotate:start", {});
        case "cancel_annotate":
          return bus.emit("annotate:cancel", {});
        case "hint":
          return dispatch({ type: "HINT_REQUESTED" });
        case "explain":
          return dispatch({ type: "EXPLAIN_REQUESTED" });
        case "let_me_try":
          return dispatch({ type: "LET_ME_TRY" });
        case "pause":
          return dispatch({ type: "PAUSE" });
        case "resume":
          return dispatch({ type: "RESUME" });
        case "end":
          return dispatch({ type: "END_HODE" });
        case "retry":
          return dispatch({ type: "RETRY" });
        case "dismiss":
          return dispatch({ type: "DISMISS" });
        case "repeat":
          return dispatch({ type: "REPEAT" });
        case "all_steps":
          return dispatch({ type: "SHOW_ALL_STEPS" });
        case "look_again":
          return dispatch({ type: "LOOK_AGAIN" });
        case "approve":
          return dispatch({ type: "RESUME" });
        case "take_over":
          return dispatch({ type: "LET_ME_TRY" });
        case "stop_search":
          return bus.emit("web:cancel", {});
        case "skip":
          return dispatch({ type: "SKIP_STEP" });
        case "practice":
          return dispatch({ type: "PRACTICE_AGAIN" });
      }
    },
    [runtime, bus],
  );
}

/** Reports the guidance card's bottom (CSS px in the notch window) while it's shown at full size. */
export function useCardBottom(ref: RefObject<HTMLElement | null>, active: boolean, onBottom: (bottom: number) => void): void {
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    // The surface's offset parent is the container at the notch window's top, so this includes any top inset.
    const measure = () => onBottom(element.offsetTop + element.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [ref, active, onBottom]);
}

/**
 * The Windows highlights as the runtime last rendered them. Ones hidden because their window isn't in front
 * still count: un-peeking whenever the learner clicked another app made the card jump open over and over.
 */
function useDesktopPrimitives(bus: Bus): OverlayPrimitive[] {
  const [primitives, setPrimitives] = useState<OverlayPrimitive[]>([]);
  useEffect(() => {
    // Phone highlights sit on the mirror inside the notch, never under it.
    const offRender = bus.on("overlay:render", ({ primitives: next, surface }) => setPrimitives((surface ?? "windows") === "windows" ? next : []));
    const offClear = bus.on("overlay:clear", () => setPrimitives([]));
    return () => {
      offRender();
      offClear();
    };
  }, [bus]);
  return primitives;
}

/**
 * Whether the current highlight sits under the expanded top notch card (so the card should step aside).
 * Re-checked when the highlight changes and when the card's measured height does: the card grows with
 * its text, and a fixed estimate let a two-line card cover a target without stepping aside.
 */
export function useCoveringTarget(bus: Bus, shell: NativeShell, ref: RefObject<HTMLElement | null>, enabled: boolean, cardBottom?: number): boolean {
  const primitives = useDesktopPrimitives(bus);
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    if (!enabled || primitives.length === 0) {
      setCovering(false);
      return;
    }
    let alive = true;
    shell
      .notchOrigin()
      .then((origin) => {
        // The notch is centred in its container (the notch window in Tauri, the desktop layer in the stage).
        const width = ref.current?.parentElement?.clientWidth ?? window.innerWidth;
        if (alive) setCovering(coversTarget(guidanceFootprint(origin, width, cardBottom), primitives));
      })
      .catch(reportError("Couldn't check whether the notch covers the target"));
    return () => {
      alive = false;
    };
  }, [primitives, shell, ref, enabled, cardBottom]);
  return covering;
}
