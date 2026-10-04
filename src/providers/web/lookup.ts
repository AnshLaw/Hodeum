import { appsMentioned, searchName, searchableAppId } from "./apps";
import { localHelp } from "./local-help";
import type { WebProgress, WebSearch, WebSearchSource } from "./types";
import { errorText, sourceHosts, withDeadline } from "./util";

/** A spoken question can't wait longer than this for the web; Rust budgets 5.5 s for search plus reading. */
export const HOW_TO_TIMEOUT_MS = 6_000;
const MAX_QUERY_WORDS = 14;
/** Sites shown on the notch's search card. */
const SHOWN_HOSTS = 3;

/** Words that carry nothing for a search engine, or point at the screen ("this", "it"). */
const FILLER = new Set("um uh er hmm hey hi hello hodey okay ok so please this that these those it here just actually basically".split(" "));
/** How people open a request, stripped from the front until none is left. */
const OPENERS = /^(?:can you|could you|would you|will you|tell me|show me|let me know|i want to know|i want to|i wanna|i need to|help me|and)\s+/;
const HOW = /^(?:how (?:do|can|would|should|could) (?:i|you|we)|how to|how)\s+/;

/**
 * A generic how-to query from the learner's own words: filler and pointers to the screen removed,
 * plus the app as people search for it. Deterministic (no model call), so nothing from the screen can
 * steer what leaves the PC; an app outside the allow-list is never added.
 */
export function howToQuery(question: string, appName?: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%+' -]/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !FILLER.has(w));
  let text = words.join(" ");
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(OPENERS, "").replace(HOW, "");
  }
  if (text === "") return "";
  const app = searchableAppId(appName);
  const named = app !== undefined && appsMentioned(question).includes(app);
  const suffix = app && !named ? ` ${searchName(app)}` : "";
  return `how to ${text.split(" ").slice(0, MAX_QUERY_WORDS).join(" ")}${suffix}`;
}

export interface LookupDeps {
  web?: WebSearchSource;
  /** The learner's web-search setting; the offline help is used either way. */
  webEnabled: boolean | (() => boolean);
  /** The search as it happens, for the notch's search card. Ends with "finished" once a search started. */
  onProgress?: (progress: WebProgress) => void;
}

async function searchWeb(web: WebSearchSource, query: string, signal: AbortSignal, onProgress?: LookupDeps["onProgress"]): Promise<WebSearch> {
  onProgress?.({ state: "searching", query });
  try {
    const found = await withDeadline(web.search(query), HOW_TO_TIMEOUT_MS, signal);
    onProgress?.({ state: "found", query: found.query, hosts: sourceHosts(found.results.slice(0, SHOWN_HOSTS).map((r) => r.url)) });
    return found;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    console.error("Web lookup failed; Hodey answers without it", error);
    onProgress?.({ state: "failed", query });
    return { query, results: [], failures: [errorText(error)] };
  } finally {
    onProgress?.({ state: "finished" });
  }
}

/**
 * Reference steps for a spoken question or an open-ended goal: the offline help first, then (if the
 * learner turned web search on) one web search. A failed search comes back as `failures`, not a throw;
 * cancelling `signal` rejects with its reason. Undefined: nothing to go on.
 */
export async function lookupHowTo(question: string, appName: string | undefined, signal: AbortSignal, deps: LookupDeps): Promise<WebSearch | undefined> {
  if (signal.aborted) throw signal.reason;
  const local = localHelp(question, appName);
  if (local) return local;
  const enabled = typeof deps.webEnabled === "function" ? deps.webEnabled() : deps.webEnabled;
  const query = howToQuery(question, appName);
  if (!enabled || !deps.web || query === "") return undefined;
  return searchWeb(deps.web, query, signal, deps.onProgress);
}

/** `lookupHowTo` bound to its dependencies, for the runtime to hold. */
export function createHowToLookup(deps: LookupDeps) {
  return (question: string, appName?: string, signal: AbortSignal = new AbortController().signal) => lookupHowTo(question, appName, signal, deps);
}
