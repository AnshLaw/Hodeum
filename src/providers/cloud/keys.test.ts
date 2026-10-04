import { describe, expect, it, vi } from "vitest";
import { CloudKeys, NO_KEYS } from "./keys";

describe("CloudKeys", () => {
  it("treats every key as missing until Rust says otherwise", async () => {
    const keys = new CloudKeys(async <T,>() => ({ gemini: true, elevenlabs: false, backboard: false }) as T);
    expect(keys.current()).toEqual(NO_KEYS);
    await keys.refresh();
    expect(keys.current().gemini).toBe(true);
  });

  it("keeps cloud off when the credential store can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const keys = new CloudKeys(async () => Promise.reject(new Error("locked")));
    expect(await keys.refresh()).toEqual(NO_KEYS);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("sends a key to Rust and re-reads presence without keeping the key", async () => {
    const calls: [string, unknown][] = [];
    const keys = new CloudKeys(async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return (command === "cloud_key_status" ? { gemini: true, elevenlabs: false, backboard: false } : undefined) as T;
    });
    await keys.save("gemini", "AIza-secret");
    expect(calls).toEqual([["cloud_key_set", { provider: "gemini", key: "AIza-secret" }], ["cloud_key_status", undefined]]);
    expect(JSON.stringify(keys.current())).not.toContain("AIza");
  });
});
