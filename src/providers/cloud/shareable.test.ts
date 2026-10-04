import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../../features/hode/model";
import { PACK } from "../../features/hode/test-fixtures";
import { lessonSpeech } from "./shareable";

const lesson: HodeState = { ...initialState, phase: "guiding", pack: PACK };

describe("lessonSpeech", () => {
  it("allows the cloud voice for a lesson Hode's guidance", () => {
    expect(lessonSpeech(lesson)).toBe(true);
  });

  it("keeps answers about the screen local", () => {
    expect(lessonSpeech({ ...lesson, phase: "answering" })).toBe(false);
    expect(lessonSpeech({ ...lesson, spokenQuestion: "what is this number?" })).toBe(false);
  });

  it("keeps open-ended goals and idle chatter local", () => {
    expect(lessonSpeech({ ...lesson, pack: undefined, open: true })).toBe(false);
    expect(lessonSpeech(initialState)).toBe(false);
  });
});
