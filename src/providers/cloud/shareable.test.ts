import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import { TASK_PACKS } from "../../task-packs";
import { localizePack } from "../../task-packs/localize";
import { lessonCorpus, shareableText } from "./shareable";

const corpus = lessonCorpus(TASK_PACKS);
const PIVOT = TASK_PACKS.find((pack) => pack.id === "excel-pivot")!;

describe("shareableText", () => {
  it("lets lesson lines and Hodey's fixed phrases go to the cloud voice, in every language", () => {
    expect(shareableText(PIVOT.steps[0].speech.guide, corpus)).toBe(true);
    expect(shareableText(PIVOT.steps[0].explain, corpus)).toBe(true);
    expect(shareableText(localizePack(PIVOT, "hi").steps[0].speech.demonstrate, corpus)).toBe(true);
    expect(shareableText(spoken("hinglish").hodeCompleteSpeech, corpus)).toBe(true);
    expect(shareableText(spoken().acks[0], corpus)).toBe(true);
  });

  it("lets a step's acknowledgement go with the next instruction, and a Teach line ending in the why", () => {
    for (const language of ["en", "hi", "hinglish"] as const) {
      const say = spoken(language);
      const step = localizePack(PIVOT, language).steps[1];
      for (const ack of [...say.stepDone, ...say.stepDoneLight]) expect(shareableText(`${ack} ${step.speech.hint}`, corpus)).toBe(true);
      expect(shareableText(`${step.speech.demonstrate} ${step.explain}`, corpus)).toBe(true);
    }
  });

  it("keeps anything else local: answers, open-goal guidance, lines that name what's on screen", () => {
    expect(shareableText("That cell says 90,000.", corpus)).toBe(false);
    expect(shareableText(spoken().itsHere("Q3 salaries.xlsx"), corpus)).toBe(false);
    expect(shareableText(`${PIVOT.steps[0].speech.guide} Your file is Budget.xlsx.`, corpus)).toBe(false);
    expect(shareableText("", corpus)).toBe(false);
  });

  it("ignores spacing differences", () => {
    expect(shareableText(`  ${PIVOT.steps[0].speech.guide}  `, corpus)).toBe(true);
  });
});
