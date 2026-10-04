import { detectLanguage, type ReplyLanguage } from "../../lib/language";
import type { Bus } from "../../lib/bus";
import { errorMessage } from "../../lib/errors";
import type { AssistanceLevel, HodeMode, Rect, StepOutcome, TeachingContext } from "../../lib/types";
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
/** Room echo and audio latency: Hodey's last words can reach the mic this long after playback ends. */
const ECHO_WINDOW_MS = 1500;

export class HodeRuntime {
  private state: HodeState = initialState;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void>;
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private speech: AbortController | undefined;
  /** Skill writes are chained so the next step's read sees the previous step's outcome. */
  private pendingWrite: Promise<void> = Promise.resolve();
  private saying: { text: string; endedAt: number | undefined } | undefined;
  private readonly speechFinishedListeners = new Set<() => void>();
  private focusing: Promise<void> = Promise.resolve();
  private muted = false;
  /** The learner's default mode, used when a goal arrives without one. */
  private defaultMode: HodeMode = "teach";
  private stuckMs: number | undefined;
  private autoLanguage = false;
  private readonly transitionListeners = new Set<(event: HodeEvent, prev: HodeState, next: HodeState) => void>();

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

  /** Every event with the states around it (the learning-history recorder listens here). */
  onTransition(listener: (event: HodeEvent, prev: HodeState, next: HodeState) => void): () => void {
    this.transitionListeners.add(listener);
    return () => {
      this.transitionListeners.delete(listener);
    };
  }

  dispatch = (incoming: HodeEvent): void => {
    const said = learnerWords(incoming);
    if (said) this.noticeLanguage(said);
    const event = incoming.type === "GOAL_SUBMITTED" && !incoming.mode ? { ...incoming, mode: this.defaultMode } : incoming;
    const prev = this.state;
    const { state, effects } = step(prev, event);
    if (state !== prev) {
      this.state = state;
      this.listeners.forEach((listener) => listener());
    }
    this.transitionListeners.forEach((listener) => listener(event, prev, state));
    effects.forEach((effect) => this.run(effect));
  };

  /** Learner settings: where new skills start and how long before Hodey treats the learner as stuck. */
  /** The learner's default mode (Settings), offered first when starting a Hode. */
  getDefaultMode(): HodeMode {
    return this.defaultMode;
  }

  /** `language` undefined: follow whatever language the learner speaks (Settings > Voice > Language > Auto). */
  configure(options: { mode: HodeMode; stuckMs: number; language?: ReplyLanguage }): void {
    this.defaultMode = options.mode;
    this.stuckMs = options.stuckMs;
    this.autoLanguage = options.language === undefined;
    if (options.language) this.setLanguage(options.language);
  }

  /** Auto language: what the learner just said or typed decides what Hodey answers in. */
  noticeLanguage(text: string): void {
    if (this.autoLanguage) this.setLanguage(detectLanguage(text));
  }

  private setLanguage(language: ReplyLanguage): void {
    if (language !== this.state.language) this.dispatch({ type: "SET_LANGUAGE", language });
  }

  /** Barge-in: the learner started talking, so Hodey stops mid-sentence. */
  interruptSpeech(): void {
    this.stopSpeech();
  }

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
      case "focusApp":
        return this.focusApp(effect.app);
      case "loadSkill":
        return this.loadSkill(effect.skillId);
      case "observe":
        return this.observe(effect.region);
      case "reason":
        return this.reason(effect.requestId, effect.context);
      case "renderOverlay":
        return this.deps.bus.emit("overlay:render", { primitives: effect.primitives, surface: this.state.pack?.surface ?? "windows" });
      case "clearOverlay":
        return this.deps.bus.emit("overlay:clear", {});
      case "say":
        return this.say(effect.text);
      case "stopSpeech":
        return this.stopSpeech();
      case "startStuckTimer":
        return this.startStuckTimer(this.stuckMs ?? effect.ms);
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

  /** Observations wait for this, so the first read is of the app being brought forward. */
  private focusApp(app: string): void {
    const focus = this.deps.perception.focusApp?.(app) ?? Promise.resolve(false);
    this.focusing = focus.then(
      (found) => {
        if (!found) console.info(`No ${app} window is open yet; Hodey will ask the learner to open it`);
      },
      (error) => console.error(`Couldn't bring ${app} forward`, error),
    );
  }

  private observe(region?: Rect): void {
    this.focusing.then(() => this.deps.perception.observe(region)).then(
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
    const saying = { text, endedAt: undefined as number | undefined };
    this.saying = saying;
    this.deps.tts
      .speak(once(text), controller.signal)
      .then(
        () => {
          saying.endedAt = Date.now();
          if (!controller.signal.aborted) this.speechFinishedListeners.forEach((listener) => listener());
        },
        (error) => {
          saying.endedAt = Date.now();
          if (!controller.signal.aborted) console.error("Speech failed", error);
        },
      );
  }

  /** Hodey said a line in full (not interrupted): in a conversation, the learner's turn to reply. */
  onSpeechFinished(listener: () => void): () => void {
    this.speechFinishedListeners.add(listener);
    return () => {
      this.speechFinishedListeners.delete(listener);
    };
  }

  /** What Hodey is saying, or said moments ago (its voice can still be echoing back through the mic). */
  hodeySaying(): string | undefined {
    const saying = this.saying;
    if (!saying) return undefined;
    return saying.endedAt === undefined || Date.now() - saying.endedAt < ECHO_WINDOW_MS ? saying.text : undefined;
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

/** The learner's own words in an event, for detecting their language. */
function learnerWords(event: HodeEvent): string | undefined {
  if (event.type === "GOAL_SUBMITTED") return event.goal;
  if (event.type === "VOICE_QUESTION") return event.question;
  if (event.type === "ANNOTATION_SUBMITTED") return event.annotation.question;
  return undefined;
}
