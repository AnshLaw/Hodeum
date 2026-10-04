/** Mirrors `WebResult` / `WebPage` / `WebSearch` in src-tauri/src/web_search.rs. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** Which search service (or the offline help) found it. */
  source?: string;
}

/** The part of a result's page that answers the question, read after the search. */
export interface WebPage {
  title: string;
  url: string;
  text: string;
}

export interface WebSearch {
  /** Exactly what left the PC, after scrubbing; shown to the learner. Offline help: what was matched. */
  query: string;
  results: WebResult[];
  /** Who answered, e.g. "Exa (free)", "DuckDuckGo", or `LOCAL_HELP_PROVIDER` for the offline help. */
  provider?: string;
  pages?: WebPage[];
  /** Answered from the day's memory: nothing left the PC. */
  cached?: boolean;
  /** Why sources or page reads didn't help, e.g. "DuckDuckGo: blocked automated searches". */
  failures?: string[];
}

export interface WebSearchSource {
  search(query: string): Promise<WebSearch>;
}

/** How a web search from Ask Hodey is going: the app runs it, the notch shows it. */
export type WebProgress =
  | { state: "searching"; query: string }
  /** Results are in and Hodey is answering; `hosts` are the sites shown as sources (none: nothing relevant). */
  | { state: "found"; query: string; hosts: string[] }
  /** The search failed or timed out; Hodey answers from what it knows. */
  | { state: "failed"; query: string }
  /** The answer is done, failed or was stopped. */
  | { state: "finished" };
