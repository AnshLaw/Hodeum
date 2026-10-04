import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type CloudProvider, type CloudSettings } from "../../data/settings";
import { COOLDOWN_MS, CloudPolicy } from "./policy";

const ALL_KEYS: Record<CloudProvider, boolean> = { gemini: true, elevenlabs: true, backboard: true };
const NO_KEYS: Record<CloudProvider, boolean> = { gemini: false, elevenlabs: false, backboard: false };
const ALL_ON: CloudSettings = { ...DEFAULT_SETTINGS.cloud, reasoning: true, voice: true, memory: "auto" };

function policy(cloud: CloudSettings, keys = ALL_KEYS, app: { app: string; windowTitle: string } | undefined = { app: "EXCEL", windowTitle: "Sales.xlsx - Excel" }) {
  let now = 0;
  const p = new CloudPolicy({ settings: () => cloud, keys: () => keys, activeApp: () => app, now: () => now });
  return { p, advance: (ms: number) => (now += ms) };
}

describe("CloudPolicy", () => {
  it("is local by default", () => {
    const { p } = policy(DEFAULT_SETTINGS.cloud);
    expect(p.enhanced()).toBe(false);
    expect(p.allowed("gemini")).toBe(false);
  });

  it("needs a saved key as well as the toggle", () => {
    const { p } = policy(ALL_ON, NO_KEYS);
    expect(p.allowed("gemini")).toBe(false);
    expect(p.enhanced()).toBe(false);
  });

  it("allows each provider by its own toggle", () => {
    const { p } = policy({ ...DEFAULT_SETTINGS.cloud, voice: true });
    expect(p.allowed("elevenlabs")).toBe(true);
    expect(p.allowed("gemini")).toBe(false);
    expect(p.allowed("backboard")).toBe(false);
    expect(p.enhanced()).toBe(true);
  });

  it("counts read-only memory as using Backboard", () => {
    const { p } = policy({ ...DEFAULT_SETTINGS.cloud, memory: "readonly" });
    expect(p.allowed("backboard")).toBe(true);
    expect(p.writesMemory()).toBe(false);
  });

  it("keeps cloud off for sensitive apps, matched by app or window title", () => {
    const bank = policy(ALL_ON, ALL_KEYS, { app: "chrome", windowTitle: "HDFC NetBanking - Google Chrome" });
    expect(bank.p.allowed("gemini")).toBe(false);
    expect(bank.p.enhanced()).toBe(false);
    const vault = policy(ALL_ON, ALL_KEYS, { app: "1Password", windowTitle: "Vault" });
    expect(vault.p.allowed("elevenlabs")).toBe(false);
  });

  it("cools down a failed provider so later steps don't wait on it again", () => {
    const { p, advance } = policy(ALL_ON);
    p.reportFailure("gemini");
    expect(p.allowed("gemini")).toBe(false);
    expect(p.allowed("elevenlabs")).toBe(true);
    advance(COOLDOWN_MS - 1);
    expect(p.allowed("gemini")).toBe(false);
    advance(1);
    expect(p.allowed("gemini")).toBe(true);
  });

  it("clears a cooldown on success and tells listeners when the badge may change", () => {
    const { p } = policy(ALL_ON);
    let calls = 0;
    const off = p.subscribe(() => calls++);
    p.reportFailure("gemini");
    p.reportSuccess("gemini");
    expect(p.allowed("gemini")).toBe(true);
    expect(calls).toBe(2);
    off();
    p.changed();
    expect(calls).toBe(2);
  });
});
