import { useCallback, useSyncExternalStore } from "react";
import type { Watchable } from "../../lib/flag";

const NEVER: Watchable<boolean> = { current: () => false, subscribe: () => () => undefined };

/** A watchable on/off as React state, re-rendering on each change; absent, it's always off. */
export function useFlag(flag: Watchable<boolean> = NEVER): boolean {
  const subscribe = useCallback((onChange: () => void) => flag.subscribe(onChange), [flag]);
  return useSyncExternalStore(subscribe, () => flag.current());
}
