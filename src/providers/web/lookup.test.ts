import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_HELP_PROVIDER } from "./local-help";
import { HOW_TO_TIMEOUT_MS, createHowToLookup, howToQuery, lookupHowTo } from "./lookup";
import type { WebSearch } from "./types";

const FOUND: WebSearch = { query: "how to sort a column Excel", provider: "Exa (free)", results: [{ title: "Sort data", url: "https://support.microsoft.com/sort", snippet: "Select Data > Sort." }] };
const signal = () => new AbortController().signal;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("howToQuery", () => {
  it("keeps the learner's task words, drops filler, and adds the app as people search for it", () => {
    expect(howToQuery("Hey Hodey, how do I sort this column?", "Excel")).toBe("how to sort column Excel");
    expect(howToQuery("can you please tell me how to pin a chat", "whatsapp")).toBe("how to pin a chat WhatsApp Desktop");
    expect(howToQuery("turn on dark mode", "Settings")).toBe("how to turn on dark mode Windows 11 Settings");
  });

  it("doesn't repeat an app the learner already named", () => {
    expect(howToQuery("how do I open a new tab in Brave?", "Brave")).toBe("how to open a new tab in brave");
  });

  it("never adds an app name that isn't on the allow-list (a window title or exe could be personal)", () => {
    expect(howToQuery("how do I export this", "Payroll - Jane Doe")).toBe("how to export");
    expect(howToQuery("how do I export this", "acme-crm")).toBe("how to export");
  });

  it("is empty when nothing but filler was said", () => {
    expect(howToQuery("um hey hodey please", "Excel")).toBe("");
  });
});

describe("lookupHowTo", () => {
  it("answers from the offline help first, without touching the web", async () => {
    const search = vi.fn();
    const found = await lookupHowTo("how do I make a pivot table?", "Excel", signal(), { web: { search }, webEnabled: true });
    expect(found?.provider).toBe(LOCAL_HELP_PROVIDER);
    expect(search).not.toHaveBeenCalled();
  });

  it("uses the offline help even with web search off", async () => {
    const found = await lookupHowTo("pin this chat", "WhatsApp", signal(), { webEnabled: false });
    expect(found?.pages?.[0].text).toContain("Click Pin.");
  });

  it("searches the web with the deterministic query when the offline help has nothing", async () => {
    const search = vi.fn(async () => FOUND);
    const progress = vi.fn();
    const found = await lookupHowTo("how do I sort this column?", "Excel", signal(), { web: { search }, webEnabled: true, onProgress: progress });
    expect(search).toHaveBeenCalledWith("how to sort column Excel");
    expect(found).toBe(FOUND);
    expect(progress.mock.calls.map(([p]) => p.state)).toEqual(["searching", "found", "finished"]);
  });

  it("doesn't search when web search is off or there's nothing to search for", async () => {
    const search = vi.fn();
    expect(await lookupHowTo("how do I sort this column?", "Excel", signal(), { web: { search }, webEnabled: false })).toBeUndefined();
    expect(await lookupHowTo("um okay", "Excel", signal(), { web: { search }, webEnabled: true })).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });

  it("gives up after the cap and says why, so the answer can go on without it", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = lookupHowTo("how do I sort this column?", "Excel", signal(), { web: { search: () => new Promise<WebSearch>(() => undefined) }, webEnabled: true });
    await vi.advanceTimersByTimeAsync(HOW_TO_TIMEOUT_MS);
    const found = await pending;
    expect(found?.results).toEqual([]);
    expect(found?.failures?.[0]).toMatch(/6 s/);
  });

  it("reports a failed search as a reason, not a throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const found = await lookupHowTo("how do I sort this column?", "Excel", signal(), { web: { search: async () => Promise.reject(new Error("No search service could answer")) }, webEnabled: true });
    expect(found).toEqual({ query: "how to sort column Excel", results: [], failures: ["No search service could answer"] });
  });

  it("stops when the learner moves on", async () => {
    const controller = new AbortController();
    const pending = lookupHowTo("how do I sort this column?", "Excel", controller.signal, { web: { search: () => new Promise<WebSearch>(() => undefined) }, webEnabled: true });
    controller.abort(new Error("newer question"));
    await expect(pending).rejects.toThrow("newer question");
  });

  it("can be bound once to its dependencies", async () => {
    const lookup = createHowToLookup({ webEnabled: () => false });
    expect((await lookup("turn on dark mode"))?.provider).toBe(LOCAL_HELP_PROVIDER);
  });
});
