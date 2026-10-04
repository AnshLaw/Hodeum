import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../data/types";
import { COPY } from "../lib/copy";
import type { WebSearch } from "../providers/web/types";
import { WEB_SEARCH_TIMEOUT_MS, produceReply, sourceHosts } from "./chat-reply";
import type { ChatProvider } from "./services";

const QUESTION: ChatMessage = { id: "1", chatId: "c", role: "user", content: "How do I make a pivot table?", at: "2026-10-03T10:00:00Z" };
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
    expect(search).not.toHaveBeenCalled();
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
