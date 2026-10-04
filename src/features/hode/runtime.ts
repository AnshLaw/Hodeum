import { detectLanguage, type ReplyLanguage } from "../../lib/language";
import type { Bus } from "../../lib/bus";
import { errorMessage } from "../../lib/errors";
import type { AgentStyle, AssistanceLevel, HodeMode, PerformRequest, Rect, StepOutcome, TeachingContext } from "../../lib/types";
import type { LearningMemory, MemoryProvider, PerceptionAdapter, ReasoningProvider, SkillStore, TTSProvider } from "../../providers/interfaces";
import { reasonWithFallback } from "../../providers/router";
import { rememberedLevel } from "../memory/tracker";
import { initialState, type HodeEffect, type HodeEvent, type HodeState } from "./model";
import { step } from "./reducer";

export interface RuntimeDeps {
  perception: PerceptionAdapter;
  /** Tried in order; keep a local provider last. */
  reasoners: ReasoningProvider[];
  skills: SkillStore;
  bus: Bus;
  tts: TTSProvider;
  /** Learning memory recalled at the start of a pack Hode; nudges each skill's starting level. */
  memory?: Pick<MemoryProvider, "getRelevantMemory">;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

/** Runs the pure reducer and executes its effects against the adapters. */
/** Room echo and audio latency: Hodey's last words can reach the mic this long after playback ends. */
const ECHO_WINDOW_MS = 1500;
/** After Hodey presses a control, the app gets this long to respond (a menu or dialog opening) before it's read. */
export const PRESS_SETTLE_MS = 450;
const CANT_PRESS = "Hodey can't click in this app, so this step is yours.";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  private defaultAgentStyle: AgentStyle = "guide";
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private stuckMs: number | undefined;
  private autoLanguage = false;
  /** What learning memory recalled for the running Hode; skill loads wait for it. */
  private recalled: Promise<LearningMemory[]> = Promise.resolve([]);
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
    const event = incoming.type === "GOAL_SUBMITTED" ? { ...incoming, mode: incoming.mode ?? this.defaultMode, agentStyle: incoming.agentStyle ?? this.defaultAgentStyle } : incoming;
    const prev = this.state;
    const { state, effects } = step(prev, event);
    if (event.type === "GOAL_SUBMITTED" && prev.phase === "goal_entry" && state.pack) this.recall(state);
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

  /** The learner's default agent style (Settings): guide every step, or do them with checkpoints. */
  getDefaultAgentStyle(): AgentStyle {
    return this.defaultAgentStyle;
  }

  /** `language` undefined: follow whatever language the learner speaks (Settings > Voice > Language > Auto). */
  configure(options: { mode: HodeMode; agentStyle?: AgentStyle; stuckMs: number; language?: ReplyLanguage }): void {
    this.defaultMode = options.mode;
    this.defaultAgentStyle = options.agentStyle ?? "guide";
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
    this.clearPressTimer();
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
      case "perform":
        return this.schedulePress(effect.requestId, effect.request, effect.delayMs);
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
    Promise.all([this.pendingWrite.then(() => this.deps.skills.get(skillId)), this.recalled]).then(
      ([record, memories]) => this.dispatch({ type: "SKILL_LOADED", skillId, record, remembered: rememberedLevel(memories, skillId) }),
      (error) => this.fail("Couldn't load your skill progress", error),
    );
  }

  /** Asks by the pack's title and skills only: the learner's own goal words never leave this window. */
  private recall(state: HodeState): void {
    const memory = this.deps.memory;
    const pack = state.pack;
    if (!memory || !pack) return;
    const query = { goal: pack.title, skillIds: [...new Set(pack.steps.map((step) => step.skill))] };
    this.recalled = memory.getRelevantMemory(query).catch((error: unknown) => {
      console.error("Recalling learning memory failed; starting from skill progress alone", error);
      return [];
    });
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

  /** Still acting on this request: the learner hasn't paused, taken over, asked something, or ended the Hode. */
  private stillActing(requestId: number): boolean {
    return this.state.phase === "acting" && this.state.requestId === requestId;
  }

  /** Waits out the preview, then presses unless the Hode moved on meanwhile. */
  private schedulePress(requestId: number, request: PerformRequest, delayMs: number): void {
    this.clearPressTimer();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = undefined;
      if (this.stillActing(requestId)) this.press(requestId, request);
    }, delayMs);
  }

  private press(requestId: number, request: PerformRequest): void {
    const perception = this.deps.perception;
    if (!perception.perform) {
      this.dispatch({ type: "PERFORM_FAILED", requestId, message: CANT_PRESS });
      return;
    }
    perception
      .perform(request)
      .then(() => wait(PRESS_SETTLE_MS))
      .then(() => perception.observe())
      .then(
        (observation) => this.dispatch({ type: "HODEY_ACTED", requestId, observation }),
        (error) => {
          console.error(`Hodey couldn't press ${request.target.label}`, error);
          this.dispatch({ type: "PERFORM_FAILED", requestId, message: errorMessage(error) });
        },
      );
  }

  private clearPressTimer(): void {
    if (this.pressTimer !== undefined) clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
  }

  private recordOutcome(skillId: string, outcome: StepOutcome): void {
    this.pendingWrite = this.pendingWrite
      .then(() => this.deps.skills.recordOutcome(skillId, outcome))
      .then(
        // Skill views (the notch's success card, the app's learning page) refresh from the saved record.
        () => this.deps.bus.emit("data:changed", {}),
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
