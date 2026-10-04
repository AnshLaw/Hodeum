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
