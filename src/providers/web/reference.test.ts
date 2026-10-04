import { describe, expect, it } from "vitest";
import { spokenReference } from "./reference";
import type { WebSearch } from "./types";

const FOUND: WebSearch = { query: "how to make a pivot table excel", results: [{ title: "Create a PivotTable", url: "https://support.microsoft.com/pivot", snippet: "Select a cell, then Insert > PivotTable." }] };

/** A lookup that waits until its signal is aborted, then rejects with the reason. */
function hanging(): (question: string, app: string | undefined, signal: AbortSignal) => Promise<WebSearch | undefined> {
  return (_question, _app, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

function stopButton() {
  const listeners = new Set<() => void>();
  return {
    onStop: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    press: () => listeners.forEach((listener) => listener()),
    listening: () => listeners.size,
  };
}

describe("spokenReference", () => {
  it("turns what was found into one <web> block of data", async () => {
    const reference = spokenReference(async () => FOUND, stopButton().onStop);
    const text = await reference("how do I make a pivot table", "Excel", new AbortController().signal);
    expect(text).toContain("<web>");
    expect(text).toContain("[1] Create a PivotTable");
  });

  it("is undefined when nothing was found", async () => {
    const reference = spokenReference(async () => ({ query: "q", results: [] }), stopButton().onStop);
    expect(await reference("q", undefined, new AbortController().signal)).toBeUndefined();
  });

  it("skips the web when the learner presses Stop, without failing the question", async () => {
    const stop = stopButton();
    const pending = spokenReference(hanging(), stop.onStop)("how do I zip files", undefined, new AbortController().signal);
    stop.press();
    await expect(pending).resolves.toBeUndefined();
    expect(stop.listening()).toBe(0);
  });

  it("still rejects when the question itself is cancelled", async () => {
    const request = new AbortController();
    const pending = spokenReference(hanging(), stopButton().onStop)("how do I zip files", undefined, request.signal);
    request.abort(new Error("newer request"));
    await expect(pending).rejects.toThrow("newer request");
  });
});
