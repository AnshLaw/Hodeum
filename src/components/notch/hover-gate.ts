import type { Dock } from "../../features/dock/dock";

/**
 * How long a side dock stays open after the cursor seems to leave. Longer than the 380 ms open
 * animation (`--hd-dur`) plus a native hit-test poll (33 ms) and the IPC that updates its rect, so a
 * cursor that outruns the growing panel isn't read as leaving it.
 */
export const SIDEBAR_HOVER_GRACE_MS = 450;

/** The top notch's peek logic reacts to hover directly; only side docks grow under the cursor. */
export function hoverGraceMs(dock: Dock): number {
  return dock === "top" ? 0 : SIDEBAR_HOVER_GRACE_MS;
}

export interface HoverGate {
  set(inside: boolean): void;
  dispose(): void;
}

/** Hover with hysteresis: entering counts at once, leaving only once the cursor has stayed out for `graceMs`. */
export function createHoverGate(onChange: (hovered: boolean) => void, graceMs: number): HoverGate {
  let hovered = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(pending);
    pending = undefined;
  };
  const commit = (next: boolean) => {
    cancel();
    if (next === hovered) return;
    hovered = next;
    onChange(next);
  };
  return {
    set(inside) {
      if (inside || graceMs <= 0) return commit(inside);
      if (hovered && pending === undefined) pending = setTimeout(() => commit(false), graceMs);
    },
    /** Settles a pending leave now, so hover never sticks on after the listeners go away. */
    dispose() {
      if (pending !== undefined) commit(false);
    },
  };
}
