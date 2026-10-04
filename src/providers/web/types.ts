/** Mirrors `WebResult` / `WebSearch` in src-tauri/src/web_search.rs. */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearch {
  /** Exactly what left the PC, after scrubbing; shown to the learner. */
  query: string;
  results: WebResult[];
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
