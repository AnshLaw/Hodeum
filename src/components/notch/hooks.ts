import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { HodeRuntime } from "../../features/hode/runtime";
import type { Dock } from "../../features/dock/dock";
import { coversTarget, guidanceFootprint } from "./footprint";
import { createHoverGate, hoverGraceMs } from "./hover-gate";
import type { NotchControl } from "./notch-view";

/** Long enough to read what moved and the next suggestion; hovering holds it longer. */
const SUCCESS_DISPLAY_MS = 5000;

/**
 * Keeps the native hit-test in sync with the surface as it animates, so only it captures clicks.
 * `layoutKey` changes when the surface element is swapped (top notch <-> sidebar).
 */
export function useHitRect(ref: RefObject<HTMLElement | null>, shell: NativeShell, layoutKey: string): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Includes transforms, so a tucked-away (auto-hidden) surface reports just its visible sliver.
        const { x, y, width, height } = element.getBoundingClientRect();
        shell.setNotchHitRect({ x, y, width, height }).catch(reportError("Couldn't update the notch hit area"));
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    // Sliding in and out of auto-hide is a transform, which ResizeObserver doesn't see.
    element.addEventListener("transitionend", report);
    // The window growing or shrinking around the iPhone mirror moves the centred surface without resizing it.
    window.addEventListener("resize", report);
    report();
    return () => {
      observer.disconnect();
      element.removeEventListener("transitionend", report);
      window.removeEventListener("resize", report);
      cancelAnimationFrame(frame);
    };
  }, [ref, shell, layoutKey]);
}

/**
 * Hover from both DOM pointer events (browser) and the native hit-test (Tauri), because a window
 * that ignores cursor events never receives pointerleave. A side dock grows from a tab into a panel
 * under the cursor, so leaving it waits out a grace period (see `hoverGraceMs`).
 */
export function useNotchHover(ref: RefObject<HTMLElement | null>, shell: NativeShell, dock: Dock): boolean {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const gate = createHoverGate(setHovered, hoverGraceMs(dock));
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

export function useAutoDismiss(active: boolean, runtime: HodeRuntime): void {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => runtime.dispatch({ type: "DISMISS" }), SUCCESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [active, runtime]);
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
      }
    },
    [runtime, bus],
  );
}

/** Whether the current highlight sits under the expanded top notch card (so the card should step aside). */
export function useCoveringTarget(bus: Bus, shell: NativeShell, ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setCovering(false);
      return;
    }
    let alive = true;
    const offRender = bus.on("overlay:render", ({ primitives, surface }) => {
      // Phone highlights sit on the mirror inside the notch, never under it.
      if ((surface ?? "windows") !== "windows") return setCovering(false);
      shell
        .notchOrigin()
        .then((origin) => {
          // The notch is centred in its container (the notch window in Tauri, the desktop layer in the stage).
          const width = ref.current?.parentElement?.clientWidth ?? window.innerWidth;
          if (alive) setCovering(coversTarget(guidanceFootprint(origin, width), primitives));
        })
        .catch(reportError("Couldn't check whether the notch covers the target"));
    });
    const offClear = bus.on("overlay:clear", () => setCovering(false));
    return () => {
      alive = false;
      offRender();
      offClear();
    };
  }, [bus, shell, ref, enabled]);
  return covering;
}
