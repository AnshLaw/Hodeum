import type { ChatMessage } from "../data/types";
import type { CapturedFrame } from "../providers/vision/types";
import type { WebSearch, WebSearchSource } from "../providers/web/types";
import type { ChatProvider, WindowInfo, WindowSource } from "./services";

/** Sources kept with a reply; the model sees all results, the learner the main ones. */
const SHOWN_SOURCES = 3;

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
}

export interface ReplyResult {
  text: string;
  web?: ChatMessage["web"];
  /** The search failed; the answer came from the local model alone. */
  webError?: string;
}

async function maybeSearch(deps: ReplyDeps, history: ChatMessage[], frame: CapturedFrame | undefined, options: ReplyOptions): Promise<{ web?: WebSearch; webError?: string }> {
  if (!options.webEnabled || !deps.web || !deps.chat.searchQuery) return {};
  const query = await deps.chat.searchQuery(history, frame, options.signal);
  if (!query) return {};
  options.onStatus(`Searching the web for “${query}”…`);
  try {
    return { web: await deps.web.search(query) };
  } catch (error) {
    console.error("Web search failed; answering locally", error);
    return { webError: error instanceof Error ? error.message : String(error) };
  }
}

/** Looks at the attached window, searches the web if allowed and useful, then streams Hodey's answer. */
export async function produceReply(deps: ReplyDeps, history: ChatMessage[], context: WindowInfo | undefined, options: ReplyOptions): Promise<ReplyResult> {
  const frame = context && deps.windows ? await deps.windows.capture(context.id) : undefined;
  const { web, webError } = await maybeSearch(deps, history, frame, options);
  let text = "";
  for await (const chunk of deps.chat.reply(history, frame, options.signal, web)) {
    text += chunk;
    options.onText(text);
  }
  const sources = web?.results.slice(0, SHOWN_SOURCES).map(({ title, url }) => ({ title, url }));
  return { text, ...(web && sources ? { web: { query: web.query, sources } } : {}), ...(webError ? { webError } : {}) };
}
