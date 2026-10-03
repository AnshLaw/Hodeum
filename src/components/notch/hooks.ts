import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { HodeRuntime } from "../../features/hode/runtime";
import type { NotchControl } from "./notch-view";

const SUCCESS_DISPLAY_MS = 2600;

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
    report();
    return () => {
      observer.disconnect();
      element.removeEventListener("transitionend", report);
      cancelAnimationFrame(frame);
    };
  }, [ref, shell, layoutKey]);
}

/**
 * Hover from both DOM pointer events (browser) and the native hit-test (Tauri), because a window
 * that ignores cursor events never receives pointerleave.
 */
export function useNotchHover(ref: RefObject<HTMLElement | null>, shell: NativeShell, layoutKey: string): boolean {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    const stopNative = shell.onNotchHover(setHovered);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      stopNative();
    };
  }, [ref, shell, layoutKey]);
  return hovered;
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
      }
    },
    [runtime, bus],
  );
}
