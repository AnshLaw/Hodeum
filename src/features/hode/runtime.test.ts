import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { center, padRect } from "../../lib/coords";
import { spoken as spokenCopy } from "../../lib/spoken";
import type { AppSwitch, ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../test-support/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import type { HodeMode } from "../../lib/types";
import { STUCK_MS } from "./model";
import { HodeRuntime, NATIVE_SWITCH_GRACE_MS } from "./runtime";

const GOAL = "Teach me how to make a pivot table in Excel";
const FULL_HODE = ["tab:Insert", "ribbon:PivotTable", "dialog:ok", "field:Region", "field:Sales"];

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setup(reasoners: ReasoningProvider[] = [new TaskPackReasoningProvider()], skills = new MemorySkillStore()) {
  const scene = new ExcelScene();
  const perception = new MockPerception(() => scene);
  const bus = new LocalBus();
  const overlays: string[] = [];
  const surfaces: string[] = [];
  bus.on("overlay:render", ({ primitives, surface }) => {
    // A hint's area is an unlabelled highlight around the controls the target sits among.
    overlays.push(primitives.map((p) => (p.kind === "highlight" && p.label === undefined ? "area" : p.kind)).join("+"));
    surfaces.push(surface ?? "unset");
  });
  bus.on("overlay:clear", () => overlays.push("clear"));
  const spoken: string[] = [];
  const tts: TTSProvider = {
    async speak(text) {
      for await (const chunk of text) spoken.push(chunk);
    },
    async stop() {},
    async healthCheck() {
      return true;
    },
  };
  const runtime = new HodeRuntime({ perception, reasoners, skills, bus, tts });
  const start = async (mode: HodeMode = "agent") => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode });
    await settle();
  };
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      const pressed = scene.snapshot().elements.find((e) => e.id === id);
      scene.press(id, "left");
      perception.notifyLearnerAction(pressed ? [{ kind: "click", at: center(pressed.bounds), button: "left" }] : []);
      await settle();
    }
  };
  return { scene, perception, bus, runtime, overlays, surfaces, spoken, start, act, state: () => runtime.getState() };
}

const failing: ReasoningProvider = { id: "gemini", reason: () => Promise.reject(new Error("quota")), healthCheck: async () => false };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HodeRuntime end to end", () => {
  it("tags Windows guidance with the windows surface", async () => {
    const h = setup();
    await h.start();
    expect(h.surfaces.at(-1)).toBe("windows");
  });

  it("teaches the Excel PivotTable Hode, correcting a wrong tab", async () => {
    const h = setup();
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: 0, level: "demonstrate" });
    expect(h.overlays.at(-1)).toBe("spotlight+highlight+arrow");
    expect(h.spoken.at(-1)).toBe("Click the Insert tab at the top. I've highlighted it.");

    await h.act("tab:Data");
    expect(h.state().action?.kind).toBe("correct");
    expect(h.spoken.at(-1)).toBe("You opened Data. Insert is further left, right after Home.");

    await h.act(...FULL_HODE);
    expect(h.state().phase).toBe("success");
    expect(h.state().learnedSkills).toEqual(["excel.navigation.insert_tab", "excel.pivot.create", "excel.pivot.fields"]);
    expect(h.spoken.at(-1)).toBe(COPY.hodeCompleteSpeech);
  });

  it("shows Hodey thinking only while a slow reasoner works on the current request", async () => {
    let finish: () => void = () => undefined;
    const planner = new TaskPackReasoningProvider();
    const slow: ReasoningProvider = {
      id: "local-qwen3-vl",
      reason: (context, hooks) => {
        hooks?.onThinking?.();
        return new Promise((resolve) => (finish = () => resolve(planner.reason(context))));
      },
      healthCheck: async () => true,
    };
    const h = setup([slow]);
    await h.start();
    expect(h.state()).toMatchObject({ phase: "reasoning", thinking: true });
    finish();
    await settle();
    expect(h.state()).toMatchObject({ phase: "guiding" });
  });

  it("an action that changes nothing on screen leaves guidance alone: no reasoning, no speech", async () => {
    const reason = vi.fn((context) => new TaskPackReasoningProvider().reason(context));
    const h = setup([{ id: "local", reason, healthCheck: async () => true }]);
    await h.start();
    const calls = reason.mock.calls.length;
    const said = h.spoken.length;
    await h.act("nothing-here");
    expect(reason.mock.calls.length).toBe(calls);
    expect(h.spoken.length).toBe(said);
    expect(h.state()).toMatchObject({ phase: "guiding", wrongActions: 0 });
  });

  it("gives less help on a repeated skill in the next Hode", async () => {
    const skills = new MemorySkillStore();
    const first = setup(undefined, skills);
    await first.start();
    await first.act(...FULL_HODE);

    // Teach mode: a skill practised with full help starts the next Hode as a challenge.
    const second = setup(undefined, skills);
    await second.start("teach");
    await second.act("tab:Insert");
    expect(second.state()).toMatchObject({ stepIndex: 1, level: "hint" });
    // A question, with the area that holds the answer lit up rather than the answer itself.
    expect(second.overlays.at(-1)).toBe("area");
  });

  it("tells views once a step's skill progress is saved", async () => {
    const skills = new MemorySkillStore();
    const h = setup(undefined, skills);
    const saved: number[] = [];
    h.bus.on("data:changed", () => saved.push(skills.all().length));
    await h.start();
    await h.act("tab:Insert");
    expect(saved).toEqual([1]);
  });

  it("falls back to the local planner when the first provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup([failing, new TaskPackReasoningProvider()]);
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", notice: COPY.fallbackNotice });
  });

  it("shows a recoverable state when every provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup([failing]);
    await h.start();
    expect(h.state().phase).toBe("recovering");
    expect(h.state().notice).toMatch(/^Hodey couldn't work out the next step/);
  });

  it("raises help when the learner is stuck", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const skills = new MemorySkillStore();
    await skills.recordOutcome("excel.navigation.insert_tab", { completed: true, mistakes: 0, level: "guide", escalated: false });
    const h = setup(undefined, skills);
    await h.start("teach");
    expect(h.state().level).toBe("hint");
    vi.advanceTimersByTime(STUCK_MS);
    await settle();
    expect(h.state()).toMatchObject({ phase: "guiding", level: "guide" });
  });

  it("notices the learner clicking the same wrong tab again and again, and points at the right one", async () => {
    const h = setup();
    await h.start("teach");
    await h.act("tab:Home", "tab:Home", "tab:Home");
    expect(h.state()).toMatchObject({ phase: "guiding", stuck: { kind: "repeated_click", control: "Home" } });
    // Teach mode corrects with the why.
    const why = matchGoal(GOAL, TASK_PACKS)?.steps[0].explain;
    expect(h.spoken.at(-1)).toBe(`${spokenCopy("en").repeatedClick("Home")} ${why}`);
    expect(h.overlays.at(-1)).toContain("highlight");
  });

  it("anchors Windows guidance to the window it was read from", async () => {
    const h = setup();
    const window = { id: 7, bounds: { x: 0, y: 0, width: 1280, height: 800 } };
    const read = h.perception.observe.bind(h.perception);
    vi.spyOn(h.perception, "observe").mockImplementation(async (region) => ({ ...(await read(region)), window }));
    const anchors: unknown[] = [];
    h.bus.on("overlay:render", ({ anchor }) => anchors.push(anchor));
    await h.start();
    expect(anchors).toEqual([window]);
  });

  it("clears a muted answer's marks once it has been up long enough to read", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.runtime.setMuted(true);
    h.runtime.dispatch({ type: "VOICE_QUESTION", question: "what is the insert tab?" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state().phase).toBe("answering");
    expect(h.overlays.at(-1)).not.toBe("clear");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.overlays.at(-1)).toBe("clear");
  });

  it("stays silent when muted", async () => {
    const h = setup();
    h.runtime.setMuted(true);
    await h.start();
    expect(h.spoken).toEqual([]);
  });

  it("answers Point & Ask questions over the bus", async () => {
    const h = setup();
    await h.start();
    const insert = h.scene.snapshot().elements.find((e) => e.id === "tab:Insert");
    if (!insert) throw new Error("Insert tab missing from scene");
    h.bus.emit("annotate:start", {});
    h.bus.emit("annotation:submitted", {
      annotation: { id: "q", shape: { kind: "rect", bounds: padRect(insert.bounds, 4) }, intent: "ask", question: "What is this?", createdAt: 0 },
    });
    await settle();
    expect(h.state().phase).toBe("answering");
    expect(h.state().action?.speech).toMatch(/^That's Insert\./);
    // Said in full: the answer's ring and the mark go, while the answer stays on the notch.
    expect(h.overlays.slice(-2)).toEqual(["pin+highlight", "clear"]);
    h.runtime.dispatch({ type: "DISMISS" });
    await settle();
    expect(h.state().phase).toBe("guiding");
  });
});

describe("bringing the pack's app forward", () => {
  it("focuses the app before the first read of the screen", async () => {
    const scene = new ExcelScene();
    const perception = new MockPerception(() => scene);
    const order: string[] = [];
    let release: () => void = () => undefined;
    vi.spyOn(perception, "focusApp").mockImplementation(async (app) => {
      order.push(`focus ${app}`);
      await new Promise<void>((resolve) => (release = resolve));
      return true;
    });
    const observe = perception.observe.bind(perception);
    vi.spyOn(perception, "observe").mockImplementation((region) => {
      order.push("observe");
      return observe(region);
    });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent" });
    await settle();
    expect(order).toEqual(["focus Excel"]);
    release();
    await settle();
    expect(order).toEqual(["focus Excel", "observe"]);
    expect(runtime.getState().phase).toBe("guiding");
  });
});

describe("opening the pack's app", () => {
  it("launches it, waits for it, then reads the screen", async () => {
    const scene = new ExcelScene();
    const perception = new MockPerception(() => scene);
    const order: string[] = [];
    const launchApp = vi.fn(async (app: string) => {
      order.push(`launch ${app}`);
      return true;
    });
    Object.assign(perception, { launchApp });
    const focus = vi.spyOn(perception, "focusApp");
    const observe = perception.observe.bind(perception);
    vi.spyOn(perception, "observe").mockImplementation((region) => {
      order.push("observe");
      return observe(region);
    });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    const pack = matchGoal(GOAL, TASK_PACKS);
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack, mode: "agent" });
    await settle();
    expect(order).toEqual(["launch Excel", "observe"]);
    expect(launchApp).toHaveBeenCalledWith("Excel", pack?.launch);
    expect(focus).not.toHaveBeenCalled();
  });

  it("looks again by itself when the learner switches apps while Hodey waits for one", async () => {
    const scene = new ExcelScene();
    const perception = new MockPerception(() => scene);
    let switched: () => void = () => undefined;
    Object.assign(perception, { onAppSwitched: (handler: () => void) => ((switched = handler), () => undefined) });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    const waiting = { ...runtime.getState(), phase: "guiding" as const, waitingForApp: "Excel", pack: matchGoal(GOAL, TASK_PACKS) };
    runtime.dispatch({ type: "START_HODE" });
    const dispatch = vi.spyOn(runtime, "dispatch");
    Object.assign(runtime, { state: waiting });
    switched();
    expect(dispatch).toHaveBeenCalledWith({ type: "APP_SWITCHED" });
    // Whichever app came forward, the screen read decides whether it's the one (Brave will do for "a browser").
    expect(runtime.getState().phase).toBe("observing");
  });
});

describe("another app coming forward", () => {
  it("reaches the reducer every time, whichever app it is: the reducer decides what it means", () => {
    let switched: ((window: AppSwitch) => void) | undefined;
    const scene = new ExcelScene();
    const perception = Object.assign(new MockPerception(() => scene), {
      onAppSwitched: (handler: (window: AppSwitch) => void) => ((switched = handler), () => (switched = undefined)),
    });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    const seen: string[] = [];
    runtime.onTransition((event) => seen.push(event.type));
    switched?.({ app: "Discord" });
    switched?.({});
    expect(seen).toEqual(["APP_SWITCHED", "APP_SWITCHED"]);
  });
});

describe("looking it up for a spoken question", () => {
  it("adds reference steps to a spoken question's request, and only to that", async () => {
    const seen: (string | undefined)[] = [];
    const recording: ReasoningProvider = { id: "local", reason: async (context) => (seen.push(context.reference), { kind: "answer", speech: "Here.", skill: "general", assistanceLevel: "guide" }), healthCheck: async () => true };
    const scene = new ExcelScene();
    const lookups: string[] = [];
    // The offline help always; the web only with `lookUp`, here because the screen-first answer pointed at nothing.
    const reference = async (question: string, _app: string | undefined, _signal: AbortSignal, { web }: { web: boolean }) => (lookups.push(`${question} web=${web}`), "Reference for x:\n<web>\n[1] Steps\n</web>");
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [recording], skills: new MemorySkillStore(), bus: new LocalBus(), tts, reference });
    runtime.dispatch({ type: "VOICE_QUESTION", question: "how do I make a pivot table?" });
    await settle();
    expect(lookups).toEqual(["how do I make a pivot table? web=false", "how do I make a pivot table? web=true"]);
    expect(seen.at(-1)).toContain("<web>");
  });

  it("answers without it when the lookup fails", async () => {
    const seen: (string | undefined)[] = [];
    const recording: ReasoningProvider = { id: "local", reason: async (context) => (seen.push(context.reference ?? "none"), { kind: "answer", speech: "Here.", skill: "general", assistanceLevel: "guide" }), healthCheck: async () => true };
    const scene = new ExcelScene();
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [recording], skills: new MemorySkillStore(), bus: new LocalBus(), tts, reference: async () => Promise.reject(new Error("offline")) });
    runtime.dispatch({ type: "VOICE_QUESTION", question: "what is a pivot table?" });
    await settle();
    expect(seen).toEqual(["none"]);
  });
});

describe("what Hodey is saying", () => {
  it("is known while speaking and for a moment after, then forgotten", async () => {
    vi.useFakeTimers();
    const { start, runtime } = setup();
    await start();
    expect(runtime.hodeySaying()).toBeTruthy();
    // The echo of the last words arrives after the mic's end-of-speech silence and the recogniser's decode.
    await vi.advanceTimersByTimeAsync(2500);
    expect(runtime.hodeySaying()).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1500);
    expect(runtime.hodeySaying()).toBeUndefined();
  });

  it("remembers the last two lines, so an echo of either isn't obeyed", async () => {
    const { runtime } = setup();
    runtime.dispatch({ type: "CHITCHAT", kind: "greeting" });
    runtime.dispatch({ type: "CHITCHAT", kind: "unclear" });
    await settle();
    const said = runtime.hodeySaying() ?? "";
    expect(said).toContain(spokenCopy("en").greeting);
    expect(said).toContain(spokenCopy("en").notATask);
  });
});

describe("opening an installed app", () => {
  const EXCEL = { id: "Microsoft.Office.EXCEL.EXE.15", name: "Excel", kind: "desktop" as const };

  it("opens it by its catalog id, without the tip outside Teach mode", async () => {
    const h = setup();
    const openInstalledApp = vi.fn(async () => true);
    Object.assign(h.perception, { openInstalledApp });
    h.runtime.configure({ mode: "agent", stuckMs: STUCK_MS });
    h.runtime.dispatch({ type: "OPEN_APP", app: EXCEL, said: "open excel" });
    await settle();
    expect(openInstalledApp).toHaveBeenCalledWith(EXCEL.id);
    expect(h.spoken.at(-1)).toBe(spokenCopy("en").opening("Excel"));
    expect(h.state().phase).toBe("idle");
  });

  it("says so when Windows couldn't open it", async () => {
    const h = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.assign(h.perception, { openInstalledApp: vi.fn(async () => Promise.reject(new Error("ShellExecute failed"))) });
    h.runtime.dispatch({ type: "OPEN_APP", app: EXCEL, said: "open excel" });
    await settle();
    expect(error).toHaveBeenCalled();
    expect(h.spoken.at(-1)).toBe(spokenCopy("en").openFailed("Excel"));
    expect(h.state().notice).toBe(spokenCopy("en").openFailed("Excel"));
  });

  it("says so when the app never appears", async () => {
    const h = setup();
    Object.assign(h.perception, { openInstalledApp: vi.fn(async () => false) });
    h.runtime.dispatch({ type: "OPEN_APP", app: EXCEL, said: "open excel" });
    await settle();
    expect(h.spoken.at(-1)).toBe(spokenCopy("en").openFailed("Excel"));
  });

  it("says so where apps can't be opened at all", async () => {
    const h = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.runtime.dispatch({ type: "OPEN_APP", app: EXCEL, said: "open excel" });
    await settle();
    expect(h.spoken.at(-1)).toBe(spokenCopy("en").openFailed("Excel"));
  });
});

describe("an app Hodey opened coming forward", () => {
  const EXCEL = { id: "Microsoft.Office.EXCEL.EXE.15", name: "Excel", kind: "desktop" as const };

  /** `watcher`: the perception reports window switches itself, as the native one does. */
  function opening(watcher: boolean) {
    let switched: ((window: AppSwitch) => void) | undefined;
    let appear: (appeared: boolean) => void = () => undefined;
    const scene = new ExcelScene();
    const perception = Object.assign(new MockPerception(() => scene), {
      openInstalledApp: vi.fn(() => new Promise<boolean>((resolve) => (appear = resolve))),
      ...(watcher ? { onAppSwitched: (handler: (window: AppSwitch) => void) => ((switched = handler), () => (switched = undefined)) } : {}),
    });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    let switches = 0;
    runtime.onTransition((event) => {
      if (event.type === "APP_SWITCHED") switches += 1;
    });
    runtime.dispatch({ type: "OPEN_APP", app: EXCEL, said: "open excel" });
    return {
      appears: async () => {
        appear(true);
        await settle();
      },
      watcherReports: () => switched?.({ app: "Excel" }),
      switches: () => switches,
    };
  }

  it("is reported once when the window watcher reports it soon after the open", async () => {
    vi.useFakeTimers();
    const h = opening(true);
    await h.appears();
    expect(h.switches()).toBe(0);
    await vi.advanceTimersByTimeAsync(NATIVE_SWITCH_GRACE_MS / 2);
    h.watcherReports();
    expect(h.switches()).toBe(1);
    await vi.advanceTimersByTimeAsync(NATIVE_SWITCH_GRACE_MS * 2);
    expect(h.switches()).toBe(1);
  });

  it("is reported once when the watcher saw the window come forward while it was still opening", async () => {
    vi.useFakeTimers();
    const h = opening(true);
    h.watcherReports();
    await h.appears();
    await vi.advanceTimersByTimeAsync(NATIVE_SWITCH_GRACE_MS * 2);
    expect(h.switches()).toBe(1);
  });

  it("is reported by Hodey when the watcher says nothing within the grace period", async () => {
    vi.useFakeTimers();
    const h = opening(true);
    await h.appears();
    await vi.advanceTimersByTimeAsync(NATIVE_SWITCH_GRACE_MS - 1);
    expect(h.switches()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.switches()).toBe(1);
  });

  it("is reported at once where nothing watches window switches", async () => {
    const h = opening(false);
    await h.appears();
    expect(h.switches()).toBe(1);
  });
});

describe("Hodey finishing a sentence", () => {
  it("tells listeners when a line was spoken in full, but not when it was cut off", async () => {
    const { start, runtime } = setup();
    const finished = vi.fn();
    runtime.onSpeechFinished(finished);
    await start();
    expect(finished).toHaveBeenCalled();
    finished.mockClear();
    runtime.interruptSpeech();
    await settle();
    expect(finished).not.toHaveBeenCalled();
  });
});
