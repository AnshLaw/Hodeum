import { describe, expect, it } from "vitest";
import { el } from "../../features/hode/test-fixtures";
import type { UiElement } from "../../lib/types";
import {
  agreementConfidence,
  askedRoles,
  asksAboutWindow,
  groundTarget,
  isWindowCaption,
  labelTier,
  quotedLabels,
  resolveTarget,
  stableName,
  utterancePoints,
  type ResolveInput,
} from "./grounding";

const row = (y: number) => ({ y, height: 30 });
const MUTE = el("Mute app", "button", { bounds: { x: 1360, ...row(870), width: 40 } });
const SLIDER = el("System sounds", "slider", { bounds: { x: 1500, ...row(870), width: 300 } });
const FAR_SLIDER = el("Volume", "slider", { bounds: { x: 1500, ...row(330), width: 300 } });
const PANE = el("Sound", "pane", { bounds: { x: 0, y: 0, width: 1900, height: 1000 } });
const ELEMENTS = [PANE, FAR_SLIDER, MUTE, SLIDER];

describe("askedRoles", () => {
  it("reads the kind of control the learner asks about", () => {
    expect(askedRoles("Can you show me where the slider")).toContain("slider");
    expect(askedRoles("where is the volume slider?")).toContain("slider");
    expect(askedRoles("which dropdown picks the speaker")).toContain("combo box");
    expect(askedRoles("turn on the toggle")).toContain("toggle switch");
  });

  it("asks about no role when none is named", () => {
    expect(askedRoles("what does this do")).toEqual([]);
  });
});

describe("utterancePoints", () => {
  it("favours controls of the asked role and controls the learner names", () => {
    expect(utterancePoints(SLIDER, "where is the slider")).toBeGreaterThan(0);
    expect(utterancePoints(MUTE, "where is the slider")).toBe(0);
    expect(utterancePoints(MUTE, "what does mute app do")).toBeGreaterThan(0);
  });

  it("ignores short and filler words", () => {
    expect(utterancePoints(el("The app", "button"), "is the app")).toBe(0);
  });
});

describe("groundTarget", () => {
  it("moves a pick of the wrong kind to the asked control beside it", () => {
    expect(groundTarget({ chosen: MUTE, elements: ELEMENTS, utterance: "show me where the slider" })).toBe(SLIDER);
  });

  it("keeps a pick that is already the asked kind", () => {
    expect(groundTarget({ chosen: FAR_SLIDER, elements: ELEMENTS, utterance: "where is the slider" })).toBe(FAR_SLIDER);
  });

  it("follows the model's box when its numbered pick sits elsewhere (a miscounted index)", () => {
    const box = { x: 1600, y: 875, width: 20, height: 20 };
    expect(groundTarget({ chosen: MUTE, box, elements: ELEMENTS })).toBe(SLIDER);
  });

  it("snaps a box-only answer to the control under it", () => {
    const box = { x: 1365, y: 872, width: 30, height: 25 };
    expect(groundTarget({ box, elements: ELEMENTS })).toBe(MUTE);
  });

  it("finds nothing for a box over no control", () => {
    expect(groundTarget({ box: { x: 5000, y: 5000, width: 10, height: 10 }, elements: ELEMENTS })).toBeUndefined();
  });
});

/** Measured on a maximized Brave window (scratchpad/grounding/brave_max_obs.json), with the regions the screen read tags. */
const top = (x: number, width: number) => ({ x, y: 0, width, height: 80 });
const bar = (x: number, width = 56) => ({ x, y: 92, width, height: 56 });
const MINIMIZE = el("Minimize", "button", { bounds: top(2798, 90), container: "title bar" });
const RESTORE = el("Restore", "button", { bounds: top(2888, 92), container: "title bar" });
const CLOSE_WINDOW = el("Close", "button", { bounds: top(2980, 92), container: "title bar" });
const BACK = el("Back", "button", { bounds: bar(0, 68), container: "toolbar" });
const ADDRESS = el("Address and search bar", "edit", { bounds: bar(608, 1584), container: "toolbar" });
const VPN = el("VPN", "button", { bounds: bar(2944), container: "toolbar" });
const MENU = el("Brave", "button", { bounds: bar(3004, 68), container: "toolbar" });
const PAGE = el("(148) YouTube", "document", { bounds: { x: 0, y: 230, width: 3072, height: 1594 }, container: "page" });
const TAB_SEARCH = el("Tab search", "button", { bounds: { x: 2742, y: 12, width: 56, height: 56 }, container: "tab strip" });
const TAB_YT = el("(148) YouTube", "tab item", { bounds: top(0, 496), container: "tab strip" });
const CLOSE_TAB = el("Close", "button", { bounds: { x: 430, y: 12, width: 56, height: 56 }, container: "tab '(148) YouTube'" });
const TAB_NEW = el("New Tab - Memory usage - 39.4 MB", "tab item", { bounds: top(500, 496), container: "tab strip" });
const NEW_TAB = el("New Tab", "button", { bounds: top(996, 56), container: "tab strip" });
const BRAVE: UiElement[] = [MINIMIZE, RESTORE, CLOSE_WINDOW, BACK, ADDRESS, VPN, MENU, PAGE, TAB_SEARCH, TAB_YT, CLOSE_TAB, TAB_NEW, NEW_TAB];
const WINDOW = { x: -13, y: -13, width: 3098, height: 1850 };
/** The same read without regions (an older native build): the window's buttons are told apart by where they sit. */
const BARE: UiElement[] = BRAVE.map((element) => ({ ...element, container: undefined }));
const bare = (element: UiElement) => BARE[BRAVE.indexOf(element)];

describe("askedRoles for tabs", () => {
  it("doesn't read 'new tab' or 'close this tab' as asking for a tab item", () => {
    expect(askedRoles("open new tab")).not.toContain("tab item");
    expect(askedRoles("how do I close this tab")).not.toContain("tab item");
    expect(askedRoles("switch to the other tab")).toContain("tab item");
  });
});

describe("utterancePoints for whole names", () => {
  it("matches a short name said as a phrase", () => {
    expect(utterancePoints(NEW_TAB, "open new tab")).toBeGreaterThan(0);
    expect(utterancePoints(VPN, "open new tab")).toBe(0);
  });
});

describe("quotedLabels", () => {
  it("reads the control names Hodey quoted", () => {
    expect(quotedLabels("Click the 'New Tab' button")).toEqual(["New Tab"]);
    expect(quotedLabels("Don't click “Close” yet")).toEqual(["Close"]);
    expect(quotedLabels("it's fine, isn't it")).toEqual([]);
  });
});

describe("labelTier", () => {
  it("ranks exact, case-folded, word-subset and no match", () => {
    expect(labelTier("New Tab", "New Tab")).toBe(3);
    expect(labelTier("new tab", "New Tab")).toBe(2);
    expect(labelTier("New Tab", "New Tab - Memory usage - 39.4 MB")).toBe(2);
    expect(labelTier("search bar", "Address and search bar")).toBe(1);
    expect(labelTier("VPN", "Brave")).toBe(0);
    expect(labelTier("", "Brave")).toBe(0);
  });

  it("strips the browser's changing memory suffix", () => {
    expect(stableName("New Tab - High memory usage - 1.2 GB")).toBe("New Tab");
  });
});

describe("isWindowCaption", () => {
  it("knows the window's own buttons by region, or by where they sit", () => {
    expect(isWindowCaption(CLOSE_WINDOW)).toBe(true);
    expect(isWindowCaption(CLOSE_TAB)).toBe(false);
    expect(isWindowCaption(bare(CLOSE_WINDOW), WINDOW)).toBe(true);
    expect(isWindowCaption(bare(CLOSE_TAB), WINDOW)).toBe(false);
    expect(isWindowCaption(bare(NEW_TAB), WINDOW)).toBe(false);
  });

  it("knows when the learner asks about the window itself", () => {
    expect(asksAboutWindow("make the window smaller")).toBe(true);
    expect(asksAboutWindow("how do I close the browser")).toBe(true);
    expect(asksAboutWindow("how do I close this tab")).toBe(false);
    expect(asksAboutWindow(undefined)).toBe(false);
  });
});

describe("resolveTarget", () => {
  const resolve = (input: Partial<ResolveInput>) => resolveTarget({ elements: BRAVE, labels: [], window: WINDOW, ...input });

  it("follows the named control when the index points at Minimize", () => {
    expect(resolve({ chosen: MINIMIZE, labels: ["New Tab"] })).toMatchObject({ element: NEW_TAB, agreement: "label" });
    const speech = "Click the 'New Tab' button to start a fresh session.";
    expect(resolve({ chosen: MINIMIZE, labels: quotedLabels(speech) }).element).toBe(NEW_TAB);
  });

  it("trusts the index when it agrees with the label", () => {
    expect(resolve({ chosen: NEW_TAB, labels: ["New Tab"], utterance: "open new tab" })).toMatchObject({ element: NEW_TAB, agreement: "index+label", tier: 3 });
  });

  it("keeps the New Tab button for 'open new tab', not a tab item", () => {
    expect(resolve({ chosen: NEW_TAB, utterance: "open new tab" }).element).toBe(NEW_TAB);
    expect(resolve({ chosen: NEW_TAB, labels: ["New Tab"], utterance: "how do I open a new tab" }).element).toBe(NEW_TAB);
  });

  it("doesn't pick the window's Close for 'close this tab'", () => {
    const utterance = "how do I close this tab";
    expect(resolve({ chosen: CLOSE_WINDOW, labels: ["Close"], utterance }).element).toBe(CLOSE_TAB);
    expect(resolve({ chosen: CLOSE_WINDOW, labels: ["Close"], utterance, box: CLOSE_TAB.bounds })).toMatchObject({ element: CLOSE_TAB, agreement: "box+label" });
    expect(resolveTarget({ chosen: bare(CLOSE_WINDOW), labels: ["Close"], utterance, elements: BARE, window: WINDOW }).element).toBe(bare(CLOSE_TAB));
  });

  it("picks the window's Close when the learner asks to close the window", () => {
    expect(resolve({ chosen: CLOSE_TAB, labels: ["Close"], utterance: "how do I close the window" }).element).toBe(CLOSE_WINDOW);
  });

  it("uses the box, not a contradicting index, when the label names nothing listed", () => {
    const box = { x: 1200, y: 300, width: 600, height: 80 };
    expect(resolve({ chosen: VPN, labels: ["Search or ask a question"], box })).toEqual({ box, agreement: "box" });
  });

  it("is unconfirmed when the label names nothing and there's no box", () => {
    expect(resolve({ chosen: VPN, labels: ["Search or ask a question"] })).toMatchObject({ element: VPN, agreement: "index-unconfirmed" });
  });

  it("matches by words when the label is a shortened name", () => {
    expect(resolve({ chosen: BACK, labels: ["search bar"] })).toMatchObject({ element: ADDRESS, agreement: "label", tier: 1 });
  });

  it("tries the next label when the first names nothing", () => {
    expect(resolve({ chosen: MINIMIZE, labels: ["plus sign", "New Tab"] }).element).toBe(NEW_TAB);
  });

  it("falls back to the old checks with no label at all", () => {
    expect(resolveTarget({ chosen: MUTE, elements: ELEMENTS, labels: [], utterance: "show me where the slider" })).toMatchObject({ element: SLIDER, agreement: "legacy" });
  });

  it("lets a caller say what is pointable (the phone's OCR text)", () => {
    const line = el("Display & Brightness", "text");
    const pointable = (e: UiElement) => e.role === "text";
    expect(resolveTarget({ elements: [el("General", "text"), line], labels: ["Display & Brightness"], pointable })).toMatchObject({ element: line, agreement: "label" });
  });
});

describe("agreementConfidence", () => {
  it("gives a precise arrow only when two signals agree on an exact name", () => {
    expect(agreementConfidence({ element: NEW_TAB, agreement: "index+label", tier: 3 })).toBe(0.95);
    expect(agreementConfidence({ element: NEW_TAB, agreement: "box+label", tier: 3 })).toBe(0.9);
    expect(agreementConfidence({ element: NEW_TAB, agreement: "label", tier: 3 })).toBe(0.88);
    expect(agreementConfidence({ element: NEW_TAB, agreement: "label", tier: 1 })).toBe(0.75);
    expect(agreementConfidence({ element: NEW_TAB, agreement: "label-ambiguous", tier: 3 })).toBe(0.75);
    expect(agreementConfidence({ box: NEW_TAB.bounds, agreement: "box" })).toBeLessThanOrEqual(0.8);
    expect(agreementConfidence({ element: VPN, agreement: "index-unconfirmed" })).toBe(0.6);
  });

  it("never exceeds the screen read's own confidence", () => {
    expect(agreementConfidence({ element: { ...NEW_TAB, confidence: 0.7 }, agreement: "index+label", tier: 3 })).toBe(0.7);
  });
});
