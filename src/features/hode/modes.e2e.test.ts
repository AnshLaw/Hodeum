import { afterEach, describe, expect, it, vi } from "vitest";
import { notchView, stepItems } from "../../components/notch/notch-view";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { center } from "../../lib/coords";
import type { AssistanceLevel, HodeMode, TaskPack } from "../../lib/types";
import type { TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception, type MockApp, type MouseButton } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { ExplorerScene } from "../../stage/scenes/explorer";
import { TASK_PACKS } from "../../task-packs";
import { spoken as spokenCopy } from "../../lib/spoken";
import { STUCK_MS } from "./model";
import { HodeRuntime } from "./runtime";

/**
 * End-to-end Teach / Help / Agent: the real runtime, reducer, local planner and notch view, driven
 * through the practice stage's scripted Excel and File Explorer. In every mode the learner clicks.
 */

const SETTLE_TICKS = 100;
const FULL = "spotlight+highlight+arrow";
const HIGHLIGHT = "highlight";
const NONE = "clear";

async function settle(): Promise<void> {
  for (let i = 0; i < SETTLE_TICKS; i++) await Promise.resolve();
}

interface Click {
  id: string;
  button?: MouseButton;
}

interface Journey {
  name: string;
  goal: string;
  pack: TaskPack;
  scene: () => MockApp;
  clicks: Click[];
}

const packById = (id: string): TaskPack => {
  const pack = TASK_PACKS.find((p) => p.id === id);
  if (!pack) throw new Error(`task pack ${id} missing`);
  return pack;
};

const PIVOT: Journey = {
  name: "PivotTable",
  goal: "Teach me how to make a pivot table in Excel",
  pack: packById("excel-pivot"),
  scene: () => new ExcelScene(),
  clicks: [{ id: "tab:Insert" }, { id: "ribbon:PivotTable" }, { id: "dialog:ok" }, { id: "field:Region" }, { id: "field:Sales" }],
};

const ZIP: Journey = {
  name: "Zip",
  goal: "zip these files",
  pack: packById("windows-zip"),
  scene: () => new ExplorerScene(),
  clicks: [{ id: "item:report.docx", button: "right" }, { id: "menu:Compress to..." }, { id: "submenu:ZIP File" }],
};

function harness(journey: Journey, skills = new MemorySkillStore()) {
  const scene = journey.scene();
  const perception = new MockPerception(() => scene);
  const bus = new LocalBus();
  const overlays: string[] = [];
  bus.on("overlay:render", ({ primitives }) => overlays.push(primitives.map((p) => p.kind).join("+") || NONE));
  bus.on("overlay:clear", () => overlays.push(NONE));
  const said: string[] = [];
  const tts: TTSProvider = {
    async speak(text) {
      for await (const chunk of text) said.push(chunk);
    },
    stop: async () => undefined,
    healthCheck: async () => true,
  };
  const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills, bus, tts });
  let heard = 0;
  /** Lines spoken since the last call. */
  const newSpeech = () => said.slice(heard, (heard = said.length));
  const state = () => runtime.getState();
  return { scene, perception, runtime, overlays, said, newSpeech, state, view: () => notchView(state()), list: () => stepItems(state()) };
}

type Harness = ReturnType<typeof harness>;

async function start(h: Harness, journey: Journey, mode: HodeMode): Promise<void> {
  h.runtime.dispatch({ type: "START_HODE" });
  h.runtime.dispatch({ type: "GOAL_SUBMITTED", goal: journey.goal, pack: journey.pack, mode });
  await settle();
}

async function click(h: Harness, { id, button = "left" }: Click): Promise<void> {
  const pressed = h.scene.snapshot().elements.find((e) => e.id === id);
  if (!pressed) throw new Error(`${id} isn't on the practice screen`);
  h.scene.press(id, button);
  h.perception.notifyLearnerAction([{ kind: "click", at: center(pressed.bounds), button }]);
  await settle();
}

async function dispatchAndSettle(h: Harness, type: "HINT_REQUESTED" | "STUCK_TIMEOUT"): Promise<void> {
  h.runtime.dispatch({ type });
  await settle();
}

const step = (journey: Journey, index: number) => journey.pack.steps[index];
const why = (journey: Journey, index: number) => step(journey, index).explain;
const highlighted = (overlay: string | undefined) => overlay !== undefined && overlay.includes(HIGHLIGHT);

afterEach(() => {
  vi.useRealTimers();
});

/** Where each step starts for a brand-new learner (later steps reuse a skill practised earlier in the Hode). */
const START_LEVELS: Record<HodeMode, Record<string, AssistanceLevel[]>> = {
  teach: { PivotTable: ["hint", "hint", "observe", "hint", "observe"], Zip: ["hint", "hint", "observe"] },
  help: { PivotTable: ["observe", "observe", "independent", "observe", "independent"], Zip: ["observe", "observe", "independent"] },
  agent: { PivotTable: ["demonstrate", "demonstrate", "guide", "demonstrate", "guide"], Zip: ["demonstrate", "demonstrate", "guide"] },
};

const EN = spokenCopy("en");
const stepEyebrow = (journey: Journey, index: number, mode: string) => `${COPY.stepOf(index + 1, journey.pack.steps.length)} · ${mode}`;

/**
 * After the first step, the step just done is acknowledged: said ahead of the new guidance (one line, so
 * the instruction can't cut it off), shown as the notch's eyebrow, and never the same phrase twice running.
 */
function expectAck(h: Harness, journey: Journey, index: number, pool: readonly string[], mode: string): string {
  const ack = h.state().ack;
  if (index === 0) {
    expect(ack).toBeUndefined();
    expect(h.view().eyebrow).toBe(stepEyebrow(journey, index, mode));
    return "";
  }
  expect(pool).toContain(ack);
  expect(h.view().eyebrow).toBe(ack);
  return ack ?? "";
}

const line = (...parts: string[]) => parts.filter((part) => part !== "").join(" ");

/** Teach: a question and no highlight; a skill just practised unaided gets only "Your turn". Never the whole flow. */
function expectTeachStep(h: Harness, journey: Journey, index: number, said: string[]): void {
  const s = step(journey, index);
  const level = START_LEVELS.teach[journey.name][index];
  expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: index, level, mode: "teach" });
  expect(highlighted(h.overlays.at(-1))).toBe(false);
  const ack = expectAck(h, journey, index, [...EN.stepDone, EN.rememberedOnYourOwn], "Teach");
  const view = h.view();
  if (level === "hint") {
    expect(said).toEqual([line(ack, s.speech.hint)]);
    expect(view.title).toBe(s.speech.hint);
  } else {
    expect(said).toEqual([ack]);
    expect(view.title).toBe(`${COPY.yourTurn}: ${s.objective}`);
  }
  expect(view.hintLabel).toBe(COPY.needHint);
  expect(view.controls).toEqual(expect.arrayContaining(["hint", "explain", "all_steps", "end"]));
  expect(view.steps).toBeUndefined();
  expect(h.list().map((item) => item.state)).toEqual([...Array(index).fill("done"), "current"]);
}

/** Help: silent, no highlight, "I'm here if you get stuck", no step list. */
function expectHelpStep(h: Harness, journey: Journey, index: number, said: string[]): void {
  const level = START_LEVELS.help[journey.name][index];
  expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: index, level, mode: "help" });
  expect(said).toEqual([]);
  expect(h.state().ack).toBeUndefined();
  expect(h.overlays.every((o) => !highlighted(o))).toBe(true);
  const view = h.view();
  expect(view).toMatchObject({ title: COPY.helpStandingBy, hintLabel: COPY.needHint, eyebrow: stepEyebrow(journey, index, "Help") });
  expect(view.controls).toEqual(["hint", "point", "pause", "end"]);
  expect(view.steps).toBeUndefined();
  expect(h.list()).toEqual([]);
}

/** Agent: an explicit instruction with a highlight (full demonstration for a new skill) and the whole flow. */
function expectAgentStep(h: Harness, journey: Journey, index: number, said: string[]): void {
  const level = START_LEVELS.agent[journey.name][index];
  const s = step(journey, index);
  expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: index, level, mode: "agent" });
  const ack = expectAck(h, journey, index, EN.stepDoneLight, "Agent · Guide me");
  expect(said).toEqual([line(ack, s.speech[level])]);
  expect(h.overlays.at(-1)).toBe(level === "demonstrate" ? FULL : HIGHLIGHT);
  const view = h.view();
  expect(view.title).toBe(s.speech[level]);
  expect(view.controls).not.toContain("all_steps");
  const flow = journey.pack.steps.map((_, i) => (i < index ? "done" : i === index ? "current" : "todo"));
  expect(view.steps?.map((item) => item.state)).toEqual(flow);
  expect(h.list().map((item) => item.state)).toEqual(flow);
}

const EXPECT_STEP: Record<HodeMode, typeof expectTeachStep> = { teach: expectTeachStep, help: expectHelpStep, agent: expectAgentStep };

describe.each([PIVOT, ZIP])("a full $name Hode", (journey) => {
  it.each(["teach", "help", "agent"] as const)("in %s mode: the learner clicks every step and Hodey verifies it", async (mode) => {
    const h = harness(journey);
    await start(h, journey, mode);
    const acks: (string | undefined)[] = [];
    for (const [index, next] of journey.clicks.entries()) {
      EXPECT_STEP[mode](h, journey, index, h.newSpeech());
      acks.push(h.state().ack);
      await click(h, next);
    }
    expect(acks.every((ack, i) => ack === undefined || ack !== acks[i - 1])).toBe(true);
    expect(h.state().phase).toBe("success");
    expect(h.newSpeech()).toEqual([COPY.hodeCompleteSpeech]);
    expect(h.view()).toMatchObject({ mode: "success", title: COPY.hodeComplete });
    expect(h.list().every((item) => item.state === "done")).toBe(true);
  });
});

describe("Help mode stays quiet", () => {
  it("never praises or comments while the learner works through steps on their own", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "help");
    for (const next of PIVOT.clicks.slice(0, -1)) await click(h, next);
    expect(h.said).toEqual([]);
  });

  it("acknowledges a step done right once Hodey has stepped in on it, then goes quiet again", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "help");
    await dispatchAndSettle(h, "HINT_REQUESTED");
    h.newSpeech();
    await click(h, PIVOT.clicks[0]);
    const ack = h.state().ack;
    expect(EN.stepDone).toContain(ack);
    expect(h.newSpeech()).toEqual([ack]);
    expect(h.view()).toMatchObject({ eyebrow: ack, title: COPY.helpStandingBy });
    await click(h, PIVOT.clicks[1]);
    expect(h.newSpeech()).toEqual([]);
    expect(h.state().ack).toBeUndefined();
  });

  it("never shows a highlight unless the learner is stuck, makes a mistake, or asks", async () => {
    const h = harness(ZIP);
    await start(h, ZIP, "help");
    await click(h, ZIP.clicks[0]);
    await click(h, ZIP.clicks[1]);
    expect(h.overlays.filter(highlighted)).toEqual([]);
  });
});

describe("a wrong action", () => {
  const DATA_TAB: Click = { id: "tab:Data" };
  const correction = PIVOT.pack.steps[0].mistakes[0].correction;

  it("in Teach: is corrected with the why, and the right tab is shown", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "teach");
    h.newSpeech();
    await click(h, DATA_TAB);
    expect(h.state()).toMatchObject({ level: "guide", action: { kind: "correct" } });
    expect(h.newSpeech()).toEqual([`${correction} ${why(PIVOT, 0)}`]);
    expect(h.overlays.at(-1)).toBe(HIGHLIGHT);
    expect(h.view().title).toBe(`${correction} ${why(PIVOT, 0)}`);
  });

  it("in Help: Hodey steps in with the correction and points at the right tab", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "help");
    await click(h, DATA_TAB);
    expect(h.state()).toMatchObject({ level: "hint", action: { kind: "correct" } });
    expect(h.newSpeech()).toEqual([correction]);
    expect(h.overlays.at(-1)).toBe(HIGHLIGHT);
    expect(h.view().title).toBe(correction);
  });

  it("in Agent: is corrected while the demonstration stays up", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "agent");
    h.newSpeech();
    await click(h, DATA_TAB);
    expect(h.newSpeech()).toEqual([correction]);
    expect(h.overlays.at(-1)).toBe(FULL);
  });

  it.each(["teach", "help", "agent"] as const)("in %s: two unexpected clicks on Zip raise help by one rung, then the Hode finishes", async (mode) => {
    const h = harness(ZIP);
    await start(h, ZIP, mode);
    h.newSpeech();
    await click(h, { id: "item:notes.txt" });
    expect(h.newSpeech()).toEqual([]);
    await click(h, { id: "item:photo.jpg" });
    const expected = { teach: ["guide", HIGHLIGHT], help: ["hint", NONE], agent: ["demonstrate", FULL] }[mode];
    expect(h.state().level).toBe(expected[0]);
    expect(h.overlays.at(-1)).toBe(expected[1]);
    for (const next of ZIP.clicks) await click(h, next);
    expect(h.state().phase).toBe("success");
  });
});

/** What each successive hint (or stuck timeout) shows on PivotTable step 1. */
const LADDER: Record<HodeMode, Array<{ level: AssistanceLevel; overlay: string; speech: (j: Journey) => string }>> = {
  teach: [
    { level: "guide", overlay: HIGHLIGHT, speech: (j) => step(j, 0).speech.guide },
    { level: "demonstrate", overlay: FULL, speech: (j) => `${step(j, 0).speech.demonstrate} ${why(j, 0)}` },
  ],
  help: [
    { level: "hint", overlay: NONE, speech: (j) => step(j, 0).speech.hint },
    { level: "guide", overlay: HIGHLIGHT, speech: (j) => step(j, 0).speech.guide },
    { level: "demonstrate", overlay: FULL, speech: (j) => step(j, 0).speech.demonstrate },
  ],
  agent: [{ level: "demonstrate", overlay: FULL, speech: (j) => `${why(j, 0)} ${step(j, 0).speech.demonstrate}` }],
};

describe.each(["HINT_REQUESTED", "STUCK_TIMEOUT"] as const)("help revealed gradually on %s", (event) => {
  it.each(["teach", "help", "agent"] as const)("in %s mode", async (mode) => {
    const h = harness(PIVOT);
    await start(h, PIVOT, mode);
    h.newSpeech();
    for (const rung of LADDER[mode]) {
      await dispatchAndSettle(h, event);
      expect(h.state()).toMatchObject({ phase: "guiding", level: rung.level });
      expect(h.newSpeech()).toEqual([rung.speech(PIVOT)]);
      expect(h.overlays.at(-1)).toBe(rung.overlay);
      expect(h.view().title).toBe(rung.speech(PIVOT));
    }
    await click(h, PIVOT.clicks[0]);
    expect(h.state()).toMatchObject({ stepIndex: 1 });
  });
});

describe("the stuck timer", () => {
  it("in Help: after a quiet wait, Hodey offers the question first, with no highlight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness(ZIP);
    await start(h, ZIP, "help");
    expect(h.said).toEqual([]);
    vi.advanceTimersByTime(STUCK_MS);
    await settle();
    expect(h.state().level).toBe("hint");
    expect(h.newSpeech()).toEqual([step(ZIP, 0).speech.hint]);
    expect(highlighted(h.overlays.at(-1))).toBe(false);
  });

  it("in Teach: shows the target after a wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness(ZIP);
    await start(h, ZIP, "teach");
    h.newSpeech();
    vi.advanceTimersByTime(STUCK_MS);
    await settle();
    expect(h.newSpeech()).toEqual([step(ZIP, 0).speech.guide]);
    expect(h.overlays.at(-1)).toBe(HIGHLIGHT);
  });
});

describe("Teach with a practised skill", () => {
  it("starts with less help the next time: no question, no highlight, just Your turn", async () => {
    const skills = new MemorySkillStore();
    const first = harness(PIVOT, skills);
    await start(first, PIVOT, "teach");
    for (const next of PIVOT.clicks) await click(first, next);

    const second = harness(PIVOT, skills);
    await start(second, PIVOT, "teach");
    expect(second.state()).toMatchObject({ stepIndex: 0, level: "observe" });
    expect(second.said).toEqual([]);
    expect(second.overlays.filter(highlighted)).toEqual([]);
    expect(second.view().title).toBe(`${COPY.yourTurn}: ${step(PIVOT, 0).objective}`);
    await click(second, PIVOT.clicks[0]);
    expect(second.said[0]).toBe(COPY.rememberedOnYourOwn);
  });

  it("never starts above a question, even after a fully demonstrated Hode", async () => {
    const skills = new MemorySkillStore();
    const first = harness(PIVOT, skills);
    await start(first, PIVOT, "agent");
    for (const next of PIVOT.clicks) await click(first, next);

    const second = harness(PIVOT, skills);
    await start(second, PIVOT, "teach");
    expect(second.state().level).toBe("hint");
    expect(second.overlays.filter(highlighted)).toEqual([]);
  });
});

describe("All steps in Teach", () => {
  it("reveals the upcoming steps only when asked", async () => {
    const h = harness(PIVOT);
    await start(h, PIVOT, "teach");
    expect(h.view().steps).toBeUndefined();
    h.runtime.dispatch({ type: "SHOW_ALL_STEPS" });
    expect(h.view().steps?.map((item) => item.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });
});
