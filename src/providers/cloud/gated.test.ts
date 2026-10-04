import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_SELECTED, PACK } from "../../features/hode/test-fixtures";
import type { TeachingAction, TeachingContext } from "../../lib/types";
import type { ReasoningProvider } from "../interfaces";
import { reasonWithFallback } from "../router";
import { CloudSkipped, GatedReasoner, type GatePolicy } from "./gated";

const ACTION: TeachingAction = { kind: "guide", speech: "Click Insert.", skill: "s", assistanceLevel: "guide" };
const ctx: TeachingContext = { goal: "pivot", pack: PACK, step: PACK.steps[0], observation: HOME_SELECTED, assistanceLevel: "guide", recentMistakes: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

function gate(allowed: boolean) {
  return { allowed: vi.fn(() => allowed), reportSuccess: vi.fn(), reportFailure: vi.fn() } satisfies GatePolicy;
}

function inner(reason: () => Promise<TeachingAction>): ReasoningProvider {
  return { id: "gemini", reason: vi.fn(reason), healthCheck: async () => true };
}

describe("GatedReasoner", () => {
  it("skips without calling the provider when the policy disallows it", async () => {
    const provider = inner(async () => ACTION);
    const policy = gate(false);
    await expect(new GatedReasoner(provider, "gemini", policy).reason(ctx)).rejects.toBeInstanceOf(CloudSkipped);
    expect(provider.reason).not.toHaveBeenCalled();
    expect(policy.allowed).toHaveBeenCalledWith("gemini");
    expect(policy.reportFailure).not.toHaveBeenCalled();
  });

  it("reports success", async () => {
    const policy = gate(true);
    expect(await new GatedReasoner(inner(async () => ACTION), "gemini", policy).reason(ctx)).toBe(ACTION);
    expect(policy.reportSuccess).toHaveBeenCalledWith("gemini");
  });

  it("reports a failure and rethrows it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const policy = gate(true);
    const gated = new GatedReasoner(inner(async () => Promise.reject(new Error("quota"))), "gemini", policy);
    await expect(gated.reason(ctx)).rejects.toThrow("quota");
    expect(policy.reportFailure).toHaveBeenCalledWith("gemini");
    expect(policy.reportSuccess).not.toHaveBeenCalled();
  });

  it("doesn't count a provider declining the request as a failure", async () => {
    const policy = gate(true);
    const gated = new GatedReasoner(inner(async () => Promise.reject(new CloudSkipped("gemini", "learner question"))), "gemini", policy);
    await expect(gated.reason(ctx)).rejects.toBeInstanceOf(CloudSkipped);
    expect(policy.reportFailure).not.toHaveBeenCalled();
  });

  it("lights the cloud dot while context is being sent", async () => {
    const channels: string[] = [];
    const activity = { track: <T,>(channel: "screen" | "mic" | "cloud", work: () => Promise<T>) => (channels.push(channel), work()) };
    await new GatedReasoner(inner(async () => ACTION), "gemini", gate(true), activity).reason(ctx);
    expect(channels).toEqual(["cloud"]);
  });

  it("keeps the inner id so fallback notices name the provider", () => {
    expect(new GatedReasoner(inner(async () => ACTION), "gemini", gate(true)).id).toBe("gemini");
  });
});

describe("reasonWithFallback with a skipped cloud provider", () => {
  it("falls through silently: a skip is not a failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const local: ReasoningProvider = { id: "local", reason: async () => ACTION, healthCheck: async () => true };
    const routed = await reasonWithFallback([new GatedReasoner(inner(async () => ACTION), "gemini", gate(false)), local], ctx);
    expect(routed).toEqual({ action: ACTION, failures: [] });
    expect(error).not.toHaveBeenCalled();
  });
});
