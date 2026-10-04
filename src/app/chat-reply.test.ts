import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../data/types";
import type { WebSearch } from "../providers/web/types";
import { produceReply } from "./chat-reply";
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

const options = (webEnabled: boolean) => ({ webEnabled, signal: new AbortController().signal, onText: vi.fn(), onStatus: vi.fn() });

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
});
