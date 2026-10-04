import { describe, expect, it } from "vitest";
import { activeSection } from "./sections";

const LINE = 100;

describe("activeSection", () => {
  it("picks the first section before anything has scrolled past the line", () => {
    expect(activeSection([{ id: "a", top: 120 }, { id: "b", top: 600 }], LINE, false)).toBe("a");
  });

  it("picks the last section whose top has crossed the line", () => {
    expect(activeSection([{ id: "a", top: -400 }, { id: "b", top: 80 }, { id: "c", top: 500 }], LINE, false)).toBe("b");
  });

  it("picks the last section once the page is scrolled to the bottom, even if it can't reach the line", () => {
    expect(activeSection([{ id: "a", top: -900 }, { id: "b", top: -100 }, { id: "c", top: 400 }], LINE, true)).toBe("c");
  });

  it("returns undefined when no section is on the page", () => {
    expect(activeSection([], LINE, false)).toBeUndefined();
  });
});
