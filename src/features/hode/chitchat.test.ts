import { describe, expect, it } from "vitest";
import { speakable } from "../../lib/hinglish";
import { spoken } from "../../lib/spoken";
import { initialState, type HodeState } from "./model";
import { step } from "./reducer";
import { PACK, guideAction } from "./test-fixtures";

describe("CHITCHAT", () => {
  it("greets back from idle without starting a Hode, and shows it on the idle card", () => {
    const t = step(initialState, { type: "CHITCHAT", kind: "greeting" });
    expect(t.state).toMatchObject({ phase: "idle", notice: spoken("en").greeting });
    expect(t.effects).toEqual([{ type: "say", text: spoken("en").greeting }]);
  });

  it("greets in the learner's language", () => {
    const t = step({ ...initialState, language: "hinglish" }, { type: "CHITCHAT", kind: "greeting" });
    expect(t.effects).toEqual([{ type: "say", text: spoken("hinglish").greeting }]);
  });

  it("asks for a task when the goal form gets something that isn't one", () => {
    const t = step({ ...initialState, phase: "goal_entry" }, { type: "CHITCHAT", kind: "unclear" });
    expect(t.state).toMatchObject({ phase: "goal_entry", notice: spoken("en").notATask });
  });

  it("answers every time, the same reply again too, as a fresh card", () => {
    const greeting = spoken("en").greeting;
    const once = step(initialState, { type: "CHITCHAT", kind: "greeting" });
    const again = step(once.state, { type: "CHITCHAT", kind: "greeting" });
    expect(again.effects).toEqual([{ type: "say", text: greeting }]);
    expect(again.state.notice).toBe(greeting);
    expect(again.state).not.toBe(once.state);
  });

  it("takes the place of an app line on the card", () => {
    const opening = step(initialState, { type: "OPEN_APP", app: { id: "Microsoft.Office.EXCEL.EXE.15", name: "Excel", kind: "desktop" }, said: "open excel", mode: "help" }).state;
    expect(step(opening, { type: "CHITCHAT", kind: "unclear" }).state.notice).toBe(spoken("en").notATask);
  });

  it("leaves a running Hode alone", () => {
    const guiding: HodeState = { ...initialState, phase: "guiding", pack: PACK, action: guideAction() };
    expect(step(guiding, { type: "CHITCHAT", kind: "greeting" })).toEqual({ state: guiding, effects: [] });
  });
});

describe("Hinglish small talk and app lines", () => {
  it("has a Devanagari spelling for every English word, so the Hindi voice can say it", () => {
    const say = spoken("hinglish");
    const lines = [say.greeting, say.notATask, say.opening("Excel"), say.openTip, say.appNotFound("Excel"), say.appWhich(["Excel", "Windows"]), say.openFailed("Excel")];
    expect(lines.flatMap((line) => speakable(line).match(/[A-Za-z]+/g) ?? [])).toEqual([]);
  });
});
