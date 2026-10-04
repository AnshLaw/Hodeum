import { describe, expect, it } from "vitest";
import type { InstalledApp } from "../../lib/types";
import { initialState } from "./model";
import { APP_AMBIGUOUS } from "./open-app";
import { step } from "./reducer";

/** "Opening Settings…" answers the learner's last words: once the app is up, the notch has nothing left to say. */

const SETTINGS: InstalledApp = { id: "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel", name: "Settings", kind: "packaged" };
const OUTLOOK: InstalledApp = { id: "outlook", name: "Outlook", kind: "desktop" };

describe("an app opened with no Hode running", () => {
  it("clears its line once the app comes forward", () => {
    const opening = step(initialState, { type: "OPEN_APP", app: SETTINGS, said: "open settings" }).state;
    expect(opening.notice).toBeDefined();
    const up = step(opening, { type: "APP_SWITCHED" });
    expect(up.state.notice).toBeUndefined();
    expect(up.effects).toEqual([]);
  });

  it("keeps a question that still waits for the learner's answer", () => {
    const asking = step(initialState, { type: "APP_OPEN_FAILED", app: OUTLOOK, reason: APP_AMBIGUOUS, options: ["Outlook", "Outlook (classic)"] }).state;
    expect(step(asking, { type: "APP_SWITCHED" }).state).toBe(asking);
  });
});
