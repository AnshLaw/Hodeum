import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../data/types";
import { COPY } from "../lib/copy";
import { LOCAL_HELP_PROVIDER } from "../providers/web/local-help";
import type { WebSearch } from "../providers/web/types";
import { WEB_SEARCH_TIMEOUT_MS, produceReply, sourceHosts } from "./chat-reply";
import type { ChatProvider } from "./services";

/** Not in the offline help, so the web path runs. */
const QUESTION: ChatMessage = { id: "1", chatId: "c", role: "user", content: "How do I sort by cell colour?", at: "2026-10-03T10:00:00Z" };
const HELP_QUESTION: ChatMessage = { ...QUESTION, content: "How do I make a pivot table?" };
const EXCEL = { id: "w1", title: "Book1 - Excel", app: "Excel" };
const RESULTS: WebSearch = { query: "excel pivot table", results: [{ title: "Create a PivotTable", url: "https://support.microsoft.com/p", snippet: "Insert > PivotTable" }] };

function chat(query?: string): ChatProvider & { seen: (WebSearch | undefined)[] } {
  const seen: (WebSearch | undefined)[] = [];
  return {
    seen,
    async *reply(_history, _frame, _signal, web) {
      seen.push(web);
      yield "Use ";
      yield "Insert.";
    },
    searchQuery: vi.fn(async () => query),
  };
}

const options = (webEnabled: boolean, signal = new AbortController().signal) => ({ webEnabled, signal, onText: vi.fn(), onStatus: vi.fn(), onWeb: vi.fn() });
const never = () => new Promise<WebSearch>(() => undefined);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("produceReply", () => {
  it("answers locally when web search is off", async () => {
    const provider = chat("excel pivot table");
    const search = vi.fn();
    const result = await produceReply({ chat: provider, web: { search } }, [QUESTION], undefined, options(false));
    expect(result).toEqual({ text: "Use Insert." });
    expect(provider.searchQuery).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("searches with the model's generic query and cites the sources", async () => {
    const provider = chat("excel pivot table");
    const opts = options(true);
    const result = await produceReply({ chat: provider, web: { search: async () => RESULTS } }, [QUESTION], undefined, opts);
    expect(provider.seen).toEqual([RESULTS]);
    expect(result.web).toEqual({ query: "excel pivot table", sources: [{ title: "Create a PivotTable", url: "https://support.microsoft.com/p" }] });
    expect(opts.onStatus).toHaveBeenCalledWith("Searching the web for “excel pivot table”…");
  });

  it("still answers when the search fails, and says so", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = chat("excel pivot table");
    const result = await produceReply({ chat: provider, web: { search: async () => Promise.reject(new Error("offline")) } }, [QUESTION], undefined, options(true));
    expect(result).toMatchObject({ text: "Use Insert.", webError: "offline" });
    expect(provider.seen).toEqual([undefined]);
    errorLog.mockRestore();
  });

  it("skips the search when the model doesn't need one", async () => {
    const search = vi.fn();
    await produceReply({ chat: chat(undefined), web: { search } }, [QUESTION], undefined, options(true));
    expect(search).not.toHaveBeenCalled();
  });

  it("tells the notch what it searched, what it found, and when it's over", async () => {
    const opts = options(true);
    await produceReply({ chat: chat("excel pivot table"), web: { search: async () => RESULTS } }, [QUESTION], undefined, opts);
    expect(opts.onWeb.mock.calls.map(([p]) => p)).toEqual([
      { state: "searching", query: "excel pivot table" },
      { state: "found", query: "excel pivot table", hosts: ["support.microsoft.com"] },
      { state: "finished" },
    ]);
    expect(opts.onStatus).toHaveBeenLastCalledWith(COPY.readingWeb("support.microsoft.com"));
  });

  it("searches once per question: an empty result isn't retried or searched again", async () => {
    const search = vi.fn(async () => ({ query: "excel pivot table", results: [] }));
    const opts = options(true);
    const result = await produceReply({ chat: chat("excel pivot table"), web: { search } }, [QUESTION], undefined, opts);
    expect(search).toHaveBeenCalledTimes(1);
    expect(opts.onStatus).toHaveBeenLastCalledWith(COPY.webNothing);
    expect(result.web).toEqual({ query: "excel pivot table", sources: [] });
  });

  it("gives up on a search that hangs and answers from what it knows", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = chat("excel pivot table");
    const opts = options(true);
    const pending = produceReply({ chat: provider, web: { search: never } }, [QUESTION], undefined, opts);
    await vi.advanceTimersByTimeAsync(WEB_SEARCH_TIMEOUT_MS);
    const result = await pending;
    expect(result.text).toBe("Use Insert.");
    expect(result.webError).toBeDefined();
    expect(provider.seen).toEqual([undefined]);
    expect(opts.onStatus).toHaveBeenCalledWith(COPY.webFallback);
    expect(opts.onWeb).toHaveBeenCalledWith({ state: "failed", query: "excel pivot table" });
  });

  it("answers locally when deciding on a search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = chat();
    provider.searchQuery = vi.fn(async () => Promise.reject(new Error("bad JSON")));
    const search = vi.fn();
    const result = await produceReply({ chat: provider, web: { search } }, [QUESTION], undefined, options(true));
    expect(result.text).toBe("Use Insert.");
    expect(result.webError).toMatch(/couldn't work out what to search for: bad JSON/);
    expect(search).not.toHaveBeenCalled();
  });

  it("answers from the offline help first: no model decision, no search, nothing leaves the PC", async () => {
    for (const webEnabled of [true, false]) {
      const provider = chat("excel pivot table");
      const search = vi.fn();
      const opts = options(webEnabled);
      const result = await produceReply({ chat: provider, web: { search } }, [HELP_QUESTION], EXCEL, opts);
      expect(provider.seen[0]?.provider).toBe(LOCAL_HELP_PROVIDER);
      expect(provider.seen[0]?.pages?.[0].text).toContain("Select Insert > PivotTable.");
      expect(provider.searchQuery).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
      expect(opts.onWeb).not.toHaveBeenCalled();
      expect(opts.onStatus).toHaveBeenCalledWith(COPY.offlineHelp("Create a PivotTable"));
      expect(result).toEqual({ text: "Use Insert." });
    }
  });

  it("uses the offline help only for the app the chat is about", async () => {
    const provider = chat(undefined);
    await produceReply({ chat: provider }, [HELP_QUESTION], { id: "w2", title: "Untitled - Notepad", app: "Notepad" }, options(false));
    expect(provider.seen).toEqual([undefined]);
  });

  it("lists sources in the order the model numbered them: pages read first", async () => {
    const found: WebSearch = {
      query: "excel sort by colour",
      results: [
        { title: "Forum thread", url: "https://forum.example/t", snippet: "Maybe Data > Sort" },
        { title: "Sort by color", url: "https://support.microsoft.com/sort", snippet: "Select Data > Sort" },
      ],
      pages: [{ title: "Sort by color", url: "https://support.microsoft.com/sort", text: "1. Select Data > Sort." }],
    };
    const result = await produceReply({ chat: chat("excel sort by colour"), web: { search: async () => found } }, [QUESTION], undefined, options(true));
    expect(result.web?.sources.map((s) => s.url)).toEqual(["https://support.microsoft.com/sort", "https://forum.example/t"]);
  });

  it("says why the web found nothing", async () => {
    const opts = options(true);
    const empty: WebSearch = { query: "excel sort by colour", results: [], failures: ["Exa (free): rate-limited, resting 15 min", "DuckDuckGo: nothing relevant"] };
    await produceReply({ chat: chat("excel sort by colour"), web: { search: async () => empty } }, [QUESTION], undefined, opts);
    expect(opts.onStatus).toHaveBeenCalledWith(COPY.webNothingBecause("Exa (free): rate-limited, resting 15 min; DuckDuckGo: nothing relevant"));
  });

  it("stops a search when the learner cancels, without answering", async () => {
    const controller = new AbortController();
    const provider = chat("excel pivot table");
    const opts = options(true, controller.signal);
    const pending = produceReply({ chat: provider, web: { search: never } }, [QUESTION], undefined, opts);
    await vi.waitFor(() => expect(opts.onWeb).toHaveBeenCalledWith({ state: "searching", query: "excel pivot table" }));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(provider.seen).toEqual([]);
    expect(opts.onWeb).toHaveBeenLastCalledWith({ state: "finished" });
  });

  it("tells the notch the search is over even when the answer fails", async () => {
    const provider: ChatProvider = {
      // eslint-disable-next-line require-yield -- fails before the first word
      async *reply() {
        throw new Error("model stopped");
      },
      searchQuery: async () => "excel pivot table",
    };
    const opts = options(true);
    await expect(produceReply({ chat: provider, web: { search: async () => RESULTS } }, [QUESTION], undefined, opts)).rejects.toThrow("model stopped");
    expect(opts.onWeb).toHaveBeenLastCalledWith({ state: "finished" });
  });
});

describe("sourceHosts", () => {
  it("lists each site once, without www", () => {
    expect(sourceHosts(["https://www.superuser.com/q/1", "https://superuser.com/q/2", "https://learn.microsoft.com/x", "not a url"])).toEqual(["superuser.com", "learn.microsoft.com"]);
  });
});
