import { describe, expect, it } from "vitest";
import { sidebarPanelOpen, sidebarShape } from "./sidebar-view";

describe("sidebarShape", () => {
  it("is only the tucked orb while tucked, never a stretched panel or a tab around it", () => {
    expect(sidebarShape({ revealed: false, collapsed: false, panelOpen: true })).toEqual(["sidebar--tucked"]);
    expect(sidebarShape({ revealed: false, collapsed: true, panelOpen: false })).toEqual(["sidebar--tucked"]);
  });

  it("is the slim tab, the full panel, or the hovered card once revealed", () => {
    expect(sidebarShape({ revealed: true, collapsed: true, panelOpen: false })).toEqual(["sidebar--collapsed"]);
    expect(sidebarShape({ revealed: true, collapsed: false, panelOpen: true })).toEqual(["sidebar--active"]);
    expect(sidebarShape({ revealed: true, collapsed: false, panelOpen: false })).toEqual([]);
  });
});

const idle = { mode: "idle" as const, listening: false, style: "floating" as const, visibility: "auto" as const, phoneOpen: false };

describe("sidebarPanelOpen", () => {
  it("stays a slim tab while idle", () => {
    expect(sidebarPanelOpen(idle)).toBe(false);
  });

  it("opens for a running Hode, listening, or a pinned copilot", () => {
    expect(sidebarPanelOpen({ ...idle, mode: "guidance" })).toBe(true);
    expect(sidebarPanelOpen({ ...idle, listening: true })).toBe(true);
    expect(sidebarPanelOpen({ ...idle, style: "copilot", visibility: "pinned" })).toBe(true);
  });

  it("opens while the iPhone mirror is showing, so the mirror is never hidden", () => {
    expect(sidebarPanelOpen({ ...idle, phoneOpen: true })).toBe(true);
  });
});
