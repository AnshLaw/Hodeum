import type { ChatMessage } from "../data/types";
import { COPY } from "../lib/copy";
import type { CapturedFrame } from "../providers/vision/types";
import type { WebProgress, WebSearch, WebSearchSource } from "../providers/web/types";
import type { ChatProvider, WindowInfo, WindowSource } from "./services";

/** Sources kept with a reply; the model sees all results, the learner the main ones. */
const SHOWN_SOURCES = 3;
/** Rust gives each source 8 s and asks them together; past this the answer comes from the local model alone. */
export const WEB_SEARCH_TIMEOUT_MS = 12_000;

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
  /** The search failed; the answer came from the local model alone. */
  webError?: string;
}

/** Each site once, without "www.", for "Searched … · superuser.com · learn.microsoft.com". */
export function sourceHosts(urls: string[]): string[] {
  const hosts = urls.flatMap((url) => {
    try {
      return [new URL(url).hostname.replace(/^www\./, "")];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

/** `work`, unless the learner cancels (rejects with the abort reason) or it outlasts `ms`. */
function withDeadline<T>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const stop = () => reject(signal.reason);
    const timer = setTimeout(() => reject(new Error(`No answer from the web within ${ms / 1000} s`)), ms);
    signal.addEventListener("abort", stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    work.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
  });
}

/** The model's generic query, or none. A failed decision means no search, not no answer. */
async function decideQuery(chat: ChatProvider, history: ChatMessage[], signal: AbortSignal): Promise<string | undefined> {
  try {
    return await chat.searchQuery?.(history, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    console.error("Couldn't decide on a web search; answering locally", error);
    return undefined;
  }
}

/** One search per question: no retries and no second search, whatever comes back. */
async function searchOnce(web: WebSearchSource, query: string, options: ReplyOptions): Promise<{ web?: WebSearch; webError?: string }> {
  options.onStatus(COPY.searchingWeb(query));
  options.onWeb?.({ state: "searching", query });
  try {
    const found = await withDeadline(web.search(query), WEB_SEARCH_TIMEOUT_MS, options.signal);
    const hosts = sourceHosts(found.results.slice(0, SHOWN_SOURCES).map((r) => r.url));
    options.onStatus(hosts.length > 0 ? COPY.readingWeb(hosts.join(", ")) : COPY.webNothing);
    options.onWeb?.({ state: "found", query: found.query, hosts });
    return { web: found };
  } catch (error) {
    if (options.signal.aborted) throw error;
    console.error("Web search failed; answering locally", error);
    options.onStatus(COPY.webFallback);
    options.onWeb?.({ state: "failed", query });
    return { webError: error instanceof Error ? error.message : String(error) };
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

/** Looks at the attached window, searches the web if allowed and useful, then streams Hodey's answer. */
export async function produceReply(deps: ReplyDeps, history: ChatMessage[], context: WindowInfo | undefined, options: ReplyOptions): Promise<ReplyResult> {
  const frame = context && deps.windows ? await deps.windows.capture(context.id) : undefined;
  // The query is written from the learner's words alone; the frame is only for the local answer.
  const query = options.webEnabled && deps.web ? await decideQuery(deps.chat, history, options.signal) : undefined;
  if (!query || !deps.web) return { text: await streamAnswer(deps, history, frame, undefined, options) };
  try {
    const { web, webError } = await searchOnce(deps.web, query, options);
    const text = await streamAnswer(deps, history, frame, web, options);
    const sources = web?.results.slice(0, SHOWN_SOURCES).map(({ title, url }) => ({ title, url }));
    return { text, ...(web && sources ? { web: { query: web.query, sources } } : {}), ...(webError ? { webError } : {}) };
  } finally {
    options.onWeb?.({ state: "finished" });
  }
}
