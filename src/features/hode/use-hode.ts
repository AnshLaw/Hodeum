import { useSyncExternalStore } from "react";
import type { HodeState } from "./model";
import type { HodeRuntime } from "./runtime";

export function useHodeState(runtime: HodeRuntime): HodeState {
  return useSyncExternalStore(runtime.subscribe, runtime.getState);
}
