import type { ChatMessage } from "../data/types";
import { COPY } from "../lib/copy";
import { webSources } from "../providers/vision/qwen-chat-provider";
import type { CapturedFrame } from "../providers/vision/types";
import { localHelp } from "../providers/web/local-help";
import type { WebProgress, WebSearch, WebSearchSource } from "../providers/web/types";
import { errorText, sourceHosts, withDeadline } from "../providers/web/util";
import type { ChatProvider, WindowInfo, WindowSource } from "./services";

export { sourceHosts };

/** Sites named in the status line while Hodey reads. */
const SHOWN_HOSTS = 3;
/** Rust budgets 5.5 s for search plus reading pages; past this the answer comes from the local model alone. */
export const WEB_SEARCH_TIMEOUT_MS = 8_000;

export interface ReplyDeps {
  chat: ChatProvider;
  windows?: WindowSource;
  web?: WebSearchSource;
}

export interface ReplyOptions {
  webEnabled: boolean;
  signal: AbortSignal;
  onText: (text: string) => void;
  /** What Hodey is doing before words arrive, e.g. searching. */
  onStatus: (status: string) => void;
  /** The search as it happens, for the notch. Always ends with "finished" once a search started. */
  onWeb?: (progress: WebProgress) => void;
}

export interface ReplyResult {
  text: string;
  web?: ChatMessage["web"];
  /** Why the web couldn't help (search or deciding on one failed); the answer came from the local model alone. */
  webError?: string;
}

type Decision = { query?: string; error?: string };

/** The model's generic query, or none. A failed decision means no search, not no answer, and says why. */
async function decideQuery(chat: ChatProvider, history: ChatMessage[], signal: AbortSignal): Promise<Decision> {
  try {
    return { query: await chat.searchQuery?.(history, signal) };
  } catch (error) {
    if (signal.aborted) throw error;
    console.error("Couldn't decide on a web search; answering locally", error);
    return { error: COPY.webDecideFailed(errorText(error)) };
  }
}

function foundStatus(found: WebSearch): string {
  const hosts = sourceHosts(webSources(found).map((s) => s.url)).slice(0, SHOWN_HOSTS).join(", ");
  if (hosts === "") return found.failures?.length ? COPY.webNothingBecause(found.failures.join("; ")) : COPY.webNothing;
  return found.cached ? COPY.webFromMemory(hosts) : COPY.readingWeb(hosts);
}

/** One search per question: no retries and no second search, whatever comes back. */
async function searchOnce(web: WebSearchSource, query: string, options: ReplyOptions): Promise<{ web?: WebSearch; webError?: string }> {
  options.onStatus(COPY.searchingWeb(query));
  options.onWeb?.({ state: "searching", query });
  try {
    const found = await withDeadline(web.search(query), WEB_SEARCH_TIMEOUT_MS, options.signal);
    options.onStatus(foundStatus(found));
    options.onWeb?.({ state: "found", query: found.query, hosts: sourceHosts(webSources(found).map((s) => s.url)).slice(0, SHOWN_HOSTS) });
    return { web: found };
  } catch (error) {
    if (options.signal.aborted) throw error;
    console.error("Web search failed; answering locally", error);
    options.onStatus(COPY.webFallback);
    options.onWeb?.({ state: "failed", query });
    return { webError: errorText(error) };
  }
}

async function streamAnswer(deps: ReplyDeps, history: ChatMessage[], frame: CapturedFrame | undefined, web: WebSearch | undefined, options: ReplyOptions): Promise<string> {
  let text = "";
  for await (const chunk of deps.chat.reply(history, frame, options.signal, web)) {
    text += chunk;
    options.onText(text);
  }
  return text;
}

/** The offline help for the learner's latest message, in the attached app; nothing leaves the PC. */
function offlineHelp(history: ChatMessage[], context: WindowInfo | undefined): WebSearch | undefined {
  const latest = history.filter((m) => m.role === "user").at(-1);
  return latest ? localHelp(latest.content, context?.app) : undefined;
}

async function searchAndAnswer(deps: ReplyDeps & { web: WebSearchSource }, history: ChatMessage[], frame: CapturedFrame | undefined, query: string, options: ReplyOptions): Promise<ReplyResult> {
  try {
    const { web, webError } = await searchOnce(deps.web, query, options);
    const text = await streamAnswer(deps, history, frame, web, options);
    // The same numbered list the model cited from, so "[2]" is the second source shown.
    const sources = web ? webSources(web).map(({ title, url }) => ({ title, url })) : undefined;
    return { text, ...(web && sources ? { web: { query: web.query, sources } } : {}), ...(webError ? { webError } : {}) };
  } finally {
    options.onWeb?.({ state: "finished" });
  }
}

/**
 * Looks at the attached window, then grounds the answer: Hodey's offline help first, else (if the
 * learner allowed it) one web search, else the local model alone. Streams Hodey's answer.
 */
export async function produceReply(deps: ReplyDeps, history: ChatMessage[], context: WindowInfo | undefined, options: ReplyOptions): Promise<ReplyResult> {
  const frame = context && deps.windows ? await deps.windows.capture(context.id) : undefined;
  const help = offlineHelp(history, context);
  if (help) {
    // Not returned as `web`: the chat labels that "Searched the web", and nothing was searched.
    options.onStatus(COPY.offlineHelp(help.pages?.[0]?.title ?? help.results[0].title));
    return { text: await streamAnswer(deps, history, frame, help, options) };
  }
  if (!options.webEnabled || !deps.web) return { text: await streamAnswer(deps, history, frame, undefined, options) };
  // The query is written from the learner's words alone; the frame is only for the local answer.
  const decision = await decideQuery(deps.chat, history, options.signal);
  if (!decision.query) {
    const text = await streamAnswer(deps, history, frame, undefined, options);
    return { text, ...(decision.error ? { webError: decision.error } : {}) };
  }
  return searchAndAnswer({ ...deps, web: deps.web }, history, frame, decision.query, options);
}
