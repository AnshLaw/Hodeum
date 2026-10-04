import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import { nextWebActivity, webSearchView, type WebActivity } from "./web-activity";

const searching: WebActivity = { progress: { state: "searching", query: "excel pivot table" }, finished: false };

describe("nextWebActivity", () => {
  it("follows a search from query to sources, and marks it finished when the answer is done", () => {
    const found = nextWebActivity(searching, { state: "found", query: "excel pivot table", hosts: ["superuser.com"] });
    expect(found).toEqual({ progress: { state: "found", query: "excel pivot table", hosts: ["superuser.com"] }, finished: false });
    expect(nextWebActivity(found, { state: "finished" })).toEqual({ ...found, finished: true });
  });

  it("starts fresh on a new search and ignores a stray finish", () => {
    expect(nextWebActivity(undefined, { state: "searching", query: "excel pivot table" })).toEqual(searching);
    expect(nextWebActivity(undefined, { state: "finished" })).toBeUndefined();
  });

  it("closes the card when the learner stops a search before anything came back", () => {
    expect(nextWebActivity(searching, { state: "finished" })).toBeUndefined();
  });
});

describe("webSearchView", () => {
  it("opens the notch on the exact query, with a way to stop", () => {
    expect(webSearchView(searching)).toMatchObject({ size: "guidance", eyebrow: COPY.webEyebrow, title: COPY.searchingWeb("excel pivot table"), detail: COPY.webOnlyQuery, busy: true, controls: ["stop_search"] });
  });

  it("shows where the answer comes from while Hodey answers, then lets the learner close it", () => {
    const found: WebActivity = { progress: { state: "found", query: "excel pivot table", hosts: ["superuser.com", "learn.microsoft.com"] }, finished: false };
    expect(webSearchView(found)).toMatchObject({ title: COPY.webFound(2), detail: "superuser.com · learn.microsoft.com", busy: true, controls: ["stop_search"] });
    expect(webSearchView({ ...found, finished: true })).toMatchObject({ busy: false, controls: ["dismiss"] });
  });

  it("says when nothing relevant came back", () => {
    expect(webSearchView({ progress: { state: "found", query: "q", hosts: [] }, finished: true })).toMatchObject({ title: COPY.webNothing });
  });

  it("says it couldn't reach the web, never an endless spinner", () => {
    expect(webSearchView({ progress: { state: "failed", query: "q" }, finished: false })).toMatchObject({ mode: "error", title: COPY.webFallback, busy: false });
  });
});
