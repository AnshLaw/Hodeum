import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.fn<(message: string) => Promise<void>>();
let insideTauri = true;

vi.mock("@tauri-apps/plugin-log", () => ({ error: (message: string) => logError(message) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => insideTauri }));

const { reportError } = await import("./errors");

describe("reportError", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    insideTauri = true;
    logError.mockReset().mockResolvedValue(undefined);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("logs to the console and to Hodeum's log file with its context", () => {
    const failure = new Error("model offline");
    reportError("vision")(failure);
    expect(consoleError).toHaveBeenCalledWith("vision", failure);
    expect(logError).toHaveBeenCalledWith("vision: model offline");
  });

  it("only writes the log file inside the desktop app", () => {
    insideTauri = false;
    reportError("web")("boom");
    expect(consoleError).toHaveBeenCalledWith("web", "boom");
    expect(logError).not.toHaveBeenCalled();
  });

  it("never throws when the log file can't be written", async () => {
    logError.mockRejectedValue(new Error("no permission"));
    expect(() => reportError("tts")("stalled")).not.toThrow();
    await vi.waitFor(() => expect(consoleWarn).toHaveBeenCalledWith("couldn't write to Hodeum's log file", expect.any(Error)));
  });

  it("survives a log call that throws synchronously", () => {
    logError.mockImplementation(() => {
      throw new Error("ipc missing");
    });
    expect(() => reportError("asr")("silence")).not.toThrow();
    expect(consoleWarn).toHaveBeenCalledWith("couldn't write to Hodeum's log file", expect.any(Error));
  });
});
