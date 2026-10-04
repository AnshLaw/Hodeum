import { describe, expect, it } from "vitest";
import { sidebarPanelOpen } from "./sidebar-view";

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
