import { describe, expect, it } from "vitest";
import type { ActionTarget, OverlayPrimitive } from "../../lib/types";
import { overlayFor } from "./policy";
import { INSERT_BOUNDS, guideAction } from "./test-fixtures";

/** One instruction can walk through several controls: each is lit at once, numbered in the order they're used. */

const at = (x: number) => ({ x, y: 0, width: 40, height: 20 });
const control = (label: string, x: number, confidence = 0.95): ActionTarget => ({ elementId: label, bounds: at(x), confidence, label });
const FILE = control("File", 0);
const SAVE_AS = control("Save As", 100);
const NAME = control("File name", 200);

const highlights = (primitives: OverlayPrimitive[]) => primitives.filter((p): p is Extract<OverlayPrimitive, { kind: "highlight" }> => p.kind === "highlight");

describe("lighting several controls at once", () => {
  it("numbers each in flow order, and points only at the first", () => {
    const primitives = overlayFor(guideAction({ target: FILE, targets: [SAVE_AS, NAME] }));
    expect(highlights(primitives).map((h) => [h.label, h.order])).toEqual([["File", 1], ["Save As", 2], ["File name", 3]]);
    expect(primitives.filter((p) => p.kind === "arrow")).toEqual([{ kind: "arrow", to: FILE.bounds }]);
  });

  it("doesn't dim the later controls under a spotlight on the first", () => {
    expect(overlayFor(guideAction({ target: FILE, targets: [SAVE_AS] })).map((p) => p.kind)).not.toContain("spotlight");
  });

  it("leaves out a later control it isn't sure of, keeping the others' numbers", () => {
    const primitives = overlayFor(guideAction({ assistanceLevel: "guide", target: FILE, targets: [control("Save As", 100, 0.4), NAME] }));
    expect(highlights(primitives).map((h) => [h.label, h.order])).toEqual([["File", 1], ["File name", 3]]);
  });

  it("widens a later control it's only fairly sure of", () => {
    const [, later] = highlights(overlayFor(guideAction({ assistanceLevel: "guide", target: FILE, targets: [control("Save As", 100, 0.7)] })));
    expect(later).toMatchObject({ emphasis: "broad", order: 2, bounds: { x: 76, y: -24, width: 88, height: 68 } });
  });

  it("a hint still lights only the area around the first control", () => {
    const area = { x: 0, y: 0, width: 300, height: 60 };
    expect(overlayFor(guideAction({ assistanceLevel: "hint", target: FILE, targets: [SAVE_AS] }), undefined, [], area)).toEqual([{ kind: "highlight", bounds: area, emphasis: "broad" }]);
  });

  it("draws nothing when it isn't sure of the first control", () => {
    expect(overlayFor(guideAction({ target: control("File", 0, 0.4), targets: [SAVE_AS] }))).toEqual([]);
  });

  it("leaves a single control unnumbered", () => {
    const [highlight] = highlights(overlayFor(guideAction({ assistanceLevel: "guide", target: { ...FILE, bounds: INSERT_BOUNDS } })));
    expect(highlight).not.toHaveProperty("order");
  });
});
