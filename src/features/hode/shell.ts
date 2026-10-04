import type { UiElement } from "../../lib/types";
import type { PerceptionAdapter } from "../../providers/interfaces";

/**
 * The taskbar's Start button and search box (and the Start menu's search box while it's open), for pointing
 * at where to find an app. Empty where the taskbar can't be read; a failed read is logged, never thrown, so
 * the Hode always hears back.
 */
export async function observeShellTargets(perception: Pick<PerceptionAdapter, "shellTargets">): Promise<UiElement[]> {
  if (!perception.shellTargets) return [];
  try {
    return await perception.shellTargets();
  } catch (error) {
    console.error("Couldn't read the taskbar's Start button and search box", error);
    return [];
  }
}
