import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiElement } from "../../lib/types";
import { observeShellTargets } from "./shell";

const SEARCH: UiElement = { id: "shell:search", name: "Search", role: "edit", bounds: { x: 400, y: 1040, width: 200, height: 40 }, source: "uia", confidence: 0.95 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("observeShellTargets", () => {
  it("reads the taskbar's Start button and search box", async () => {
    await expect(observeShellTargets({ shellTargets: async () => [SEARCH] })).resolves.toEqual([SEARCH]);
  });

  it("is empty where the taskbar can't be read (a phone, an older build)", async () => {
    await expect(observeShellTargets({})).resolves.toEqual([]);
  });

  it("is empty when the read fails, and says why in the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(observeShellTargets({ shellTargets: async () => Promise.reject(new Error("no taskbar")) })).resolves.toEqual([]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("taskbar"), expect.any(Error));
  });
});
