import { webContext, webSources } from "../vision/qwen-chat-provider";
import type { WebSearch } from "./types";

type Lookup = (question: string, app: string | undefined, signal: AbortSignal) => Promise<WebSearch | undefined>;

/**
 * Reference steps for a spoken question, as one <web> block of data for the prompt. `onStop` is the
 * search card's Stop: it skips the web for this question, and Hodey still answers from the screen.
 */
export function spokenReference(lookup: Lookup, onStop: (listener: () => void) => () => void) {
  return async (question: string, app: string | undefined, signal: AbortSignal): Promise<string | undefined> => {
    const stop = new AbortController();
    const off = onStop(() => stop.abort());
    try {
      const found = await lookup(question, app, AbortSignal.any([signal, stop.signal]));
      return found && webSources(found).length > 0 ? webContext(found) : undefined;
    } catch (error) {
      if (stop.signal.aborted && !signal.aborted) return undefined;
      throw error;
    } finally {
      off();
    }
  };
}
