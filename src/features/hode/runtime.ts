import type { Bus } from "../../lib/bus";
import { errorMessage } from "../../lib/errors";
import type { Rect, StepOutcome, TeachingContext } from "../../lib/types";
import type { PerceptionAdapter, ReasoningProvider, SkillStore, TTSProvider } from "../../providers/interfaces";
import { reasonWithFallback } from "../../providers/router";
import { initialState, type HodeEffect, type HodeEvent, type HodeState } from "./model";
import { step } from "./reducer";

export interface RuntimeDeps {
  perception: PerceptionAdapter;
  /** Tried in order; keep a local provider last. */
  reasoners: ReasoningProvider[];
  skills: SkillStore;
  bus: Bus;
  tts: TTSProvider;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

/** Runs the pure reducer and executes its effects against the adapters. */
export class HodeRuntime {
  private state: HodeState = initialState;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void>;
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private speech: AbortController | undefined;
  /** Skill writes are chained so the next step's read sees the previous step's outcome. */
  private pendingWrite: Promise<void> = Promise.resolve();
  private muted = false;

  constructor(private readonly deps: RuntimeDeps) {
    this.disposers = [
      deps.perception.onLearnerAction((observation) => this.dispatch({ type: "LEARNER_ACTED", observation })),
      deps.bus.on("annotate:start", () => this.dispatch({ type: "ANNOTATE_START" })),
      deps.bus.on("annotate:cancel", () => this.dispatch({ type: "ANNOTATE_CANCEL" })),
      deps.bus.on("annotation:submitted", ({ annotation }) => this.dispatch({ type: "ANNOTATION_SUBMITTED", annotation })),
    ];
  }

  getState = (): HodeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (event: HodeEvent): void => {
    const { state, effects } = step(this.state, event);
    if (state !== this.state) {
      this.state = state;
      this.listeners.forEach((listener) => listener());
    }
    effects.forEach((effect) => this.run(effect));
  };

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopSpeech();
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.clearStuckTimer();
    this.stopSpeech();
  }

  private run(effect: HodeEffect): void {
    switch (effect.type) {
      case "loadSkill":
        return this.loadSkill(effect.skillId);
      case "observe":
        return this.observe(effect.region);
      case "reason":
        return this.reason(effect.requestId, effect.context);
      case "renderOverlay":
        return this.deps.bus.emit("overlay:render", { primitives: effect.primitives });
      case "clearOverlay":
        return this.deps.bus.emit("overlay:clear", {});
      case "say":
        return this.say(effect.text);
      case "stopSpeech":
        return this.stopSpeech();
      case "startStuckTimer":
        return this.startStuckTimer(effect.ms);
      case "cancelStuckTimer":
        return this.clearStuckTimer();
      case "recordOutcome":
        return this.recordOutcome(effect.skillId, effect.outcome);
    }
  }

  private loadSkill(skillId: string): void {
    this.pendingWrite
      .then(() => this.deps.skills.get(skillId))
      .then(
        (record) => this.dispatch({ type: "SKILL_LOADED", skillId, record }),
        (error) => this.fail("Couldn't load your skill progress", error),
      );
  }

  private observe(region?: Rect): void {
    this.deps.perception.observe(region).then(
      (observation) => this.dispatch({ type: "OBSERVED", observation }),
      (error) => this.fail("Couldn't read the screen", error),
    );
  }

  private reason(requestId: number, context: TeachingContext): void {
    reasonWithFallback(this.deps.reasoners, context).then(
      ({ action, failures }) => this.dispatch({ type: "ACTION_READY", requestId, action, failures }),
      (error) => this.fail("Hodey couldn't work out the next step", error, requestId),
    );
  }

  private recordOutcome(skillId: string, outcome: StepOutcome): void {
    this.pendingWrite = this.pendingWrite
      .then(() => this.deps.skills.recordOutcome(skillId, outcome))
      .then(
        () => undefined,
        (error) => console.error("Saving skill progress failed", error),
      );
  }

  private say(text: string): void {
    if (this.muted) return;
    this.speech?.abort();
    const controller = new AbortController();
    this.speech = controller;
    this.deps.tts.speak(once(text), controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error("Speech failed", error);
    });
  }

  private stopSpeech(): void {
    this.speech?.abort();
    this.speech = undefined;
    this.deps.tts.stop().catch((error) => console.error("Stopping speech failed", error));
  }

  private startStuckTimer(ms: number): void {
    this.clearStuckTimer();
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = undefined;
      this.dispatch({ type: "STUCK_TIMEOUT" });
    }, ms);
  }

  private clearStuckTimer(): void {
    if (this.stuckTimer !== undefined) clearTimeout(this.stuckTimer);
    this.stuckTimer = undefined;
  }

  private fail(context: string, error: unknown, requestId?: number): void {
    console.error(context, error);
    this.dispatch({ type: "PROVIDER_FAILED", requestId, message: `${context}: ${errorMessage(error)}` });
  }
}
