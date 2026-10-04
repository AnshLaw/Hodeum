import { describe, expect, it } from "vitest";
import { hasDevanagari, replyLanguage } from "../../lib/language";
import { spoken } from "../../lib/spoken";
import type { TeachingContext } from "../../lib/types";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { buildMessages } from "../../providers/vision/prompt";
import { TASK_PACKS, appFromGoal, matchGoal } from "../../task-packs";
import { hindiText, localizePack } from "../../task-packs/localize";
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
  it("listens and replies in the same language", () => {
    expect(replyLanguage("en-GB")).toBe("en");
    expect(replyLanguage("hi")).toBe("hi");
    expect(replyLanguage("auto")).toBe("hinglish");
  });
});

describe("Hindi task packs", () => {
  it("translates every step of every shipped pack, mistakes included", () => {
    for (const pack of TASK_PACKS) {
      const text = hindiText(pack.id);
      expect(text, pack.id).toBeDefined();
      for (const s of pack.steps) {
        expect(text?.steps[s.id], `${pack.id}/${s.id}`).toBeDefined();
        expect(text?.steps[s.id].corrections).toHaveLength(s.mistakes.length);
      }
    }
  });

  it("swaps the words but keeps targets and signals, which match the screen", () => {
    const local = localizePack(EXCEL, "hinglish");
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
});
