import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { InstalledApp } from "../../lib/types";
import catalog from "../apps/__fixtures__/start-apps.json";
import { initialState, type HodeState } from "./model";
import { APP_AMBIGUOUS, APP_NOT_FOUND, appChoiceEvent, idleOpenAppEvent, openAppEvent } from "./open-app";
import { step } from "./reducer";
import { PACK, guideAction } from "./test-fixtures";

const APPS = catalog as InstalledApp[];
const EXCEL: InstalledApp = { id: "Microsoft.Office.EXCEL.EXE.15", name: "Excel", kind: "desktop" };
const guiding: HodeState = { ...initialState, phase: "guiding", pack: PACK, goal: "pivot", stepIndex: 1, action: guideAction() };
const en = spoken("en");

describe("OPEN_APP", () => {
  it("opens the app from idle, with the tip in Teach mode", () => {
    const t = step(initialState, { type: "OPEN_APP", app: EXCEL, said: "open excel", mode: "teach" });
    const line = `${en.opening("Excel")} ${en.openTip}`;
    expect(t.effects).toEqual([{ type: "say", text: line }, { type: "launchApp", app: EXCEL }]);
    expect(t.state).toMatchObject({ phase: "idle", notice: line });
  });

  it("skips the tip outside Teach mode", () => {
    const t = step(initialState, { type: "OPEN_APP", app: EXCEL, said: "open excel", mode: "agent" });
    expect(t.effects[0]).toEqual({ type: "say", text: en.opening("Excel") });
  });

  it("closes the goal form when a typed goal asks for an app", () => {
    const entry = { ...initialState, phase: "goal_entry" as const };
    expect(step(entry, { type: "OPEN_APP", app: EXCEL, said: "open excel" }).state.phase).toBe("idle");
  });

  it("is a side errand during a Hode: the step and its card stay as they were, the line shown beside the step", () => {
    const t = step(guiding, { type: "OPEN_APP", app: EXCEL, said: "open excel" });
    const line = `${en.opening("Excel")} ${en.openTip}`;
    expect(t.state).toEqual({ ...guiding, ack: line });
    expect(t.effects).toEqual([{ type: "say", text: line }, { type: "launchApp", app: EXCEL }]);
  });

  it("never covers what a Hode's card says, in any phase: the error, Hodey's press, the step's why", () => {
    const line = `${en.opening("Excel")} ${en.openTip}`;
    for (const phase of ["answering", "paused", "acting", "checkpoint", "success", "recovering"] as const) {
      const before: HodeState = { ...guiding, phase, notice: "Couldn't read the screen", reason: "Insert holds everything you can add." };
      const after = step(before, { type: "OPEN_APP", app: EXCEL, said: "open excel" }).state;
      expect(after, phase).toEqual({ ...before, ack: line });
    }
  });

  it("shows its line beside an open-ended Hode's step too", () => {
    const open: HodeState = { ...initialState, phase: "guiding", open: true, goal: "send a pdf", action: guideAction() };
    expect(step(open, { type: "OPEN_APP", app: EXCEL, said: "open excel" }).state).toEqual({ ...open, ack: `${en.opening("Excel")} ${en.openTip}` });
  });

  it("replaces what the card said, and says it again when asked again", () => {
    const greeted = { ...initialState, notice: en.greeting };
    const first = step(greeted, { type: "OPEN_APP", app: EXCEL, said: "open excel", mode: "help" });
    expect(first.state.notice).toBe(en.opening("Excel"));
    const again = step(first.state, { type: "OPEN_APP", app: EXCEL, said: "open excel", mode: "help" });
    expect(again.effects).toEqual([{ type: "say", text: en.opening("Excel") }, { type: "launchApp", app: EXCEL }]);
  });

  it("speaks in the learner's language", () => {
    const hindi = { ...initialState, language: "hi" as const };
    const t = step(hindi, { type: "OPEN_APP", app: EXCEL, said: "एक्सेल खोलो", mode: "help" });
    expect(t.effects[0]).toEqual({ type: "say", text: spoken("hi").opening("Excel") });
  });

  it("does nothing while the learner marks the screen", () => {
    const marking = { ...initialState, phase: "annotating" as const };
    expect(step(marking, { type: "OPEN_APP", app: EXCEL, said: "open excel" }).effects).toEqual([]);
  });
});

describe("APP_OPEN_FAILED", () => {
  it("says Windows couldn't open it, and shows it when idle", () => {
    const t = step(initialState, { type: "APP_OPEN_FAILED", app: EXCEL, reason: "timeout" });
    expect(t.effects).toEqual([{ type: "say", text: en.openFailed("Excel") }]);
    expect(t.state.notice).toBe(en.openFailed("Excel"));
  });

  it("says when no app or several apps fit the name", () => {
    const missing = { id: "", name: "photoshop", kind: "desktop" as const };
    expect(step(initialState, { type: "APP_OPEN_FAILED", app: missing, reason: APP_NOT_FOUND }).state.notice).toBe(en.appNotFound("photoshop"));
    const which = step(initialState, { type: "APP_OPEN_FAILED", app: EXCEL, reason: APP_AMBIGUOUS, options: ["Outlook", "Outlook (classic)"] });
    expect(which.state.notice).toBe(en.appWhich(["Outlook", "Outlook (classic)"]));
  });

  it("shows it beside the step as well as saying it during a Hode, leaving the step and its card as they were", () => {
    const t = step(guiding, { type: "APP_OPEN_FAILED", app: EXCEL, reason: "timeout" });
    expect(t.state).toEqual({ ...guiding, ack: en.openFailed("Excel") });
    expect(t.effects).toEqual([{ type: "say", text: en.openFailed("Excel") }]);
  });

  it("isn't lost while the learner marks the screen: it waits for when they're done", () => {
    const marking = { ...guiding, phase: "annotating" as const, resumePhase: "guiding" as const };
    const t = step(marking, { type: "APP_OPEN_FAILED", app: EXCEL, reason: "timeout" });
    expect(t.state).toEqual({ ...marking, ack: en.openFailed("Excel") });
    expect(t.effects).toEqual([{ type: "say", text: en.openFailed("Excel") }]);
    expect(step(t.state, { type: "ANNOTATE_CANCEL" }).state).toMatchObject({ phase: "guiding", ack: en.openFailed("Excel") });

    const markingIdle = { ...initialState, phase: "annotating" as const, resumePhase: "idle" as const };
    const idle = step(step(markingIdle, { type: "APP_OPEN_FAILED", app: EXCEL, reason: "timeout" }).state, { type: "ANNOTATE_CANCEL" }).state;
    expect(idle).toMatchObject({ phase: "idle", notice: en.openFailed("Excel") });
  });
});

describe("choosing between the apps Hodey asked about", () => {
  const OUTLOOKS = ["Outlook", "Outlook (classic)"];
  const asked = step(initialState, { type: "APP_OPEN_FAILED", app: APPS[0], reason: APP_AMBIGUOUS, options: OUTLOOKS }).state;

  it("keeps the apps it offered while the question is on the card", () => {
    expect(asked.appChoice).toEqual(OUTLOOKS);
  });

  it("forgets them once an app opens, or another reply takes the question's place", () => {
    expect(step(asked, { type: "OPEN_APP", app: EXCEL, said: "open excel" }).state.appChoice).toBeUndefined();
    expect(step(asked, { type: "APP_OPEN_FAILED", app: { id: "", name: "photoshop", kind: "desktop" }, reason: APP_NOT_FOUND }).state.appChoice).toBeUndefined();
    expect(step(asked, { type: "CHITCHAT", kind: "greeting" }).state.appChoice).toBeUndefined();
  });

  it("opens the app a reply picks, by name or by place", () => {
    const classic = { type: "OPEN_APP", app: { id: "Microsoft.Office.OUTLOOK.EXE.15", name: "Outlook (classic)" } };
    expect(appChoiceEvent(asked, "Outlook classic", APPS)).toMatchObject({ ...classic, said: "Outlook classic" });
    expect(appChoiceEvent(asked, "the second one", APPS)).toMatchObject(classic);
    expect(appChoiceEvent(asked, "the first", APPS)).toMatchObject({ type: "OPEN_APP", app: { name: "Outlook" } });
  });

  it("is no choice when nothing was asked, the reply picks neither, or the app is gone", () => {
    expect(appChoiceEvent(initialState, "the second one", APPS)).toBeUndefined();
    expect(appChoiceEvent(asked, "the third one", APPS)).toBeUndefined();
    expect(appChoiceEvent(asked, "the second one", APPS.filter((app) => app.name !== "Outlook (classic)"))).toBeUndefined();
  });
});

describe("openAppEvent", () => {
  it("is OPEN_APP only when exactly one installed app fits", () => {
    expect(openAppEvent("open whatsapp please", APPS)).toMatchObject({ type: "OPEN_APP", app: { name: "WhatsApp" }, said: "open whatsapp please" });
    expect(openAppEvent("excel kholo", APPS)).toMatchObject({ type: "OPEN_APP", app: { name: "Excel" } });
    expect(openAppEvent("open the insert tab", APPS)).toBeUndefined();
    expect(openAppEvent("open outlook", APPS)).toBeUndefined();
    expect(openAppEvent("open excel", [])).toBeUndefined();
  });

  it("from idle, also asks which app when several fit, and says when none does and vision can't help", () => {
    expect(idleOpenAppEvent("open outlook", APPS, true)).toMatchObject({ type: "APP_OPEN_FAILED", reason: APP_AMBIGUOUS, options: ["Outlook", "Outlook (classic)"] });
    expect(idleOpenAppEvent("open photoshop", APPS, false)).toMatchObject({ type: "APP_OPEN_FAILED", reason: APP_NOT_FOUND, app: { name: "photoshop" } });
    // With vision ready, an unknown name may be a website or a task: it isn't an app request.
    expect(idleOpenAppEvent("open youtube", APPS, true)).toBeUndefined();
    expect(idleOpenAppEvent("open a new tab", APPS, false)).toBeUndefined();
  });
});
