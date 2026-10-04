import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { romanize, speakable } from "../../lib/hinglish";
import { inScript, notchView } from "../../components/notch/notch-view";
import { asrLanguage, hasDevanagari, replyLanguage } from "../../lib/language";
import type { TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { ExcelScene } from "../../test-support/scenes/excel";
import { HodeRuntime } from "./runtime";
import { spoken } from "../../lib/spoken";
import type { TeachingContext } from "../../lib/types";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { buildMessages } from "../../providers/vision/prompt";
import { TASK_PACKS, appFromGoal, matchGoal } from "../../task-packs";
import { localizePack, packText } from "../../task-packs/localize";
import { routeUtterance } from "../voice/route";
import { initialState, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK } from "./test-fixtures";

function fold(state: HodeState, ...events: HodeEvent[]): Transition {
  let t: Transition = { state, effects: [] };
  for (const event of events) t = step(t.state, event);
  return t;
}

const said = (t: Transition) => t.effects.flatMap((e) => (e.type === "say" ? [e.text] : []));
const EXCEL = TASK_PACKS.find((p) => p.id === "excel-pivot")!;
const hindi = fold(initialState, { type: "SET_LANGUAGE", language: "hi" }).state;

describe("language setting", () => {
  it("listens and replies in the same language, or follows the learner on Auto", () => {
    expect(replyLanguage("en-GB")).toBe("en");
    expect(replyLanguage("hi")).toBe("hi");
    expect(replyLanguage("hinglish")).toBe("hinglish");
    expect(replyLanguage("auto")).toBeUndefined();
    expect(asrLanguage("hinglish")).toBe("auto");
    // Auto listens in English: open language detection heard English words as Hindi.
    expect(asrLanguage("auto")).toBe("en");
  });

  it("on Auto, answers in whatever language the learner just used", () => {
    const scene = new ExcelScene();
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    runtime.configure({ mode: "teach", stuckMs: 20_000 });
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: "मुझे पिवट टेबल बनाना सिखाओ", pack: EXCEL });
    expect(runtime.getState().language).toBe("hinglish");
    runtime.noticeLanguage("what does this button do");
    expect(runtime.getState().language).toBe("en");
    runtime.configure({ mode: "teach", stuckMs: 20_000, language: "hi" });
    runtime.noticeLanguage("what does this button do");
    expect(runtime.getState().language).toBe("hi");
  });
});

describe("Hindi task packs", () => {
  it("translates every step of every shipped pack into Hindi and Hinglish, mistakes included", () => {
    for (const language of ["hi", "hinglish"] as const) {
      for (const pack of TASK_PACKS) {
        const text = packText(language, pack.id);
        expect(text, `${language}/${pack.id}`).toBeDefined();
        for (const s of pack.steps) {
          expect(text?.steps[s.id], `${language}/${pack.id}/${s.id}`).toBeDefined();
          expect(text?.steps[s.id].corrections).toHaveLength(s.mistakes.length);
        }
      }
    }
  });

  it("writes Hinglish with English words in English, the way people type it", () => {
    expect(localizePack(EXCEL, "hinglish").steps[0].speech.guide).toBe("Insert tab खोलिए।");
  });

  it("swaps the words but keeps targets and signals, which match the screen", () => {
    const local = localizePack(EXCEL, "hi");
    expect(hasDevanagari(local.steps[0].speech.demonstrate)).toBe(true);
    expect(local.steps[0].target).toEqual(EXCEL.steps[0].target);
    expect(local.steps[0].success).toEqual(EXCEL.steps[0].success);
    expect(localizePack(EXCEL, "en")).toBe(EXCEL);
  });
});

describe("a Hode in Hindi", () => {
  it("teaches from the Hindi pack and keeps the language after the Hode ends", () => {
    const started = fold(hindi, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "पिवट टेबल", pack: EXCEL, mode: "agent" });
    expect(started.state.pack?.steps[0].objective).toBe("इंसर्ट टैब खोलिए");
    expect(fold(started.state, { type: "END_HODE" }).state.language).toBe("hi");
  });

  it("says its own lines in Hindi", () => {
    const noPack = fold(hindi, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "कविता लिखो" });
    expect(said(noPack)).toEqual([spoken("hi").noPack]);
  });

  it("answers about a control in Hindi", async () => {
    const context: TeachingContext = { goal: "", observation: HOME_SELECTED, assistanceLevel: "guide", recentMistakes: 0, utterance: "where is Insert", pack: PACK, language: "hi" };
    const action = await new TaskPackReasoningProvider().reason(context);
    expect(action.speech).toBe(spoken("hi").itsHere("Insert"));
  });

  it("asks the vision model to reply in Hindi script", () => {
    const context: TeachingContext = { goal: "", observation: HOME_SELECTED, assistanceLevel: "guide", recentMistakes: 0, utterance: "ये क्या है", language: "hinglish" };
    const [, user] = buildMessages(context, [], { png: "x", rect: { x: 0, y: 0, width: 10, height: 10 } }) as [unknown, { content: { text?: string }[] }];
    expect(user.content[1].text).toContain("Devanagari");
  });
});

describe("understanding Hindi and Hinglish", () => {
  it("finds the Hode for a goal said in Hindi", () => {
    expect(matchGoal("मुझे पिवट टेबल बनाना सिखाओ", TASK_PACKS)?.id).toBe("excel-pivot");
    expect(matchGoal("ये फाइलें जिप करो", TASK_PACKS)?.id).toBe("windows-zip");
    expect(appFromGoal("एक्सेल में चार्ट बनाओ")).toBe("Excel");
  });

  it("follows spoken controls in Hindi", () => {
    const guiding: HodeState = { ...hindi, phase: "guiding", pack: PACK };
    const route = (text: string) => routeUtterance(guiding, text, TASK_PACKS, false);
    expect(route("हिंट दो")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route("फिर से बोलो")).toEqual([{ type: "REPEAT" }]);
    expect(route("रुको")).toEqual([{ type: "PAUSE" }]);
    expect(route("हो गया")).toEqual([{ type: "LOOK_AGAIN" }]);
    expect(route("ये बटन क्या करता है")).toEqual([{ type: "VOICE_QUESTION", question: "ये बटन क्या करता है" }]);
  });

  it("follows spoken controls in Hinglish written in English letters", () => {
    const guiding: HodeState = { ...hindi, phase: "guiding", pack: PACK };
    const route = (text: string) => routeUtterance(guiding, text, TASK_PACKS, false);
    expect(route("hint do")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route("phir se bolo")).toEqual([{ type: "REPEAT" }]);
    expect(route("ruko")).toEqual([{ type: "PAUSE" }]);
    expect(route("ho gaya")).toEqual([{ type: "LOOK_AGAIN" }]);
    expect(route("aage badho")).toEqual([{ type: "RESUME" }]);
  });
});

describe("Hinglish speech", () => {
  const latinLeft = (text: string) => speakable(text).match(/[A-Za-z]+/g) ?? [];

  it("has a Devanagari spelling for every English word in Hodey's Hinglish lines", () => {
    const lines: string[] = [];
    for (const pack of TASK_PACKS) {
      const local = localizePack(pack, "hinglish");
      lines.push(local.title, ...local.prerequisites, local.concept ?? "", local.recap ?? "");
      // The answers are read on the card; only the right one is ever said, inside a Hinglish sentence.
      if (local.check) lines.push(local.check.question, local.check.explain, spoken("hinglish").reviewWrong(local.check.options[local.check.answer]));
      for (const s of local.steps) lines.push(s.objective, s.speech.demonstrate, s.speech.guide, s.speech.hint, s.explain, ...s.mistakes.map((m) => m.correction));
    }
    const say = spoken("hinglish");
    lines.push(say.clarify, ...say.acks, ...say.stepDone, ...say.stepDoneLight, say.needVisionToAnswer, say.noPack, say.hodeCompleteSpeech, say.nothingMarked, say.neededForThisStep);
    lines.push(say.repeatedClick("Data"), say.menuLoop("Insert"), say.undoLoop, say.surpriseDialog("Excel"), say.targetMissing("Insert"));
    lines.push(say.youDoTheClicking, say.gotTheHang, say.cantSeeItDone, ...say.reviewRight, say.reviewWrong("Insert"), say.pickAnAnswer, say.practiceIntro, say.didItAlone);
    lines.push(say.howToOpen("Excel"), say.openedIt("Excel"), say.searchToOpen("Search", "Excel"), say.lookHere);
    expect(lines.flatMap(latinLeft)).toEqual([]);
  });
});

describe("Hindi shown in English letters", () => {
  it("rewrites the notch's words when the learner reads Hinglish that way", () => {
    const view = inScript({ ...notchView(initialState), title: "ऊपर Insert tab पर click कीजिए।", detail: "Insert tab खोलिए" }, romanize);
    expect(view.title).toBe("Upar Insert tab par click kijiye.");
    expect(view.detail).toBe("Insert tab kholiye");
  });
});
