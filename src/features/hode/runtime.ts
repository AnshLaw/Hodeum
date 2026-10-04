import { detectLanguage, type ReplyLanguage } from "../../lib/language";
import type { Bus } from "../../lib/bus";
import { errorMessage } from "../../lib/errors";
import type { AgentStyle, AppLaunch, AssistanceLevel, HodeMode, InstalledApp, LearnerAnnotation, OverlayPrimitive, PerformRequest, Point, Rect, ScreenObservation, StepOutcome, TeachingContext } from "../../lib/types";
import type { AppSwitch, LearningMemory, MemoryProvider, PerceptionAdapter, PlannerProvider, ReasoningProvider, SkillStore, TTSProvider } from "../../providers/interfaces";
import { sameApp } from "./flow";
import { reasonWithFallback } from "../../providers/router";
import { observeShellTargets } from "./shell";
import { rememberedLevel } from "../memory/tracker";
import { initialState, type HodeEffect, type HodeEvent, type HodeState } from "./model";
import { step } from "./reducer";
import { wantedNames } from "./wanted";

export interface RuntimeDeps {
  perception: PerceptionAdapter;
  /** Moves a Point & Ask mark on the mirrored iPhone into the phone's frame pixels (`surface: "phone"`). */
  placeAnnotation?: (annotation: LearnerAnnotation) => Promise<LearnerAnnotation>;
  /** Tried in order; keep a local provider last. */
  reasoners: ReasoningProvider[];
  skills: SkillStore;
  bus: Bus;
  tts: TTSProvider;
  /** Learning memory recalled at the start of a pack Hode; nudges each skill's starting level. */
  memory?: Pick<MemoryProvider, "getRelevantMemory">;
  /**
   * Reference steps for a spoken question, as a <web> block: the offline help, and the web only when `web`
   * (the learner asked to look it up) and Settings allows it.
   */
  reference?: (question: string, app: string | undefined, signal: AbortSignal, options: { web: boolean }) => Promise<string | undefined>;
  /** Plans open Teach Hodes in the background; without one, they're planned a step at a time. */
  planner?: PlannerProvider;
  /**
   * Reference steps for planning a goal, looked up quietly (no search card over the first step): the offline
   * help, and the web when Settings allows it.
   */
  planReference?: (goal: string, app: string | undefined, signal: AbortSignal) => Promise<string | undefined>;
  /** Where the learner's pointer is, in physical screen px; rejects when it can't be read. */
  pointer?: () => Promise<Point>;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

/** Runs the pure reducer and executes its effects against the adapters. */
/**
 * Room echo and audio latency: Hodey's last words can come back as a transcript this long after playback ends
 * (the mic's 0.9 s end-of-speech silence plus the recogniser's decode).
 */
const ECHO_WINDOW_MS = 3500;
/** Lines of Hodey's kept for echo checks: an answer and the acknowledgement before it can both come back. */
const ECHO_LINES = 2;
/** The native side waits up to ~45 s for a slow app (Excel cold-starts in ~21 s); this only catches a hung call. */
const OPEN_APP_TIMEOUT_MS = 60_000;
/**
 * Once an app Hodey opened is up, how long the window watcher gets to report it coming forward (it lets a new
 * front window settle first) before Hodey reports the switch itself.
 */
export const NATIVE_SWITCH_GRACE_MS = 1500;
/** After Hodey presses a control, the app gets this long to respond (a menu or dialog opening) before it's read. */
export const PRESS_SETTLE_MS = 450;
const CANT_PRESS = "Hodey can't click in this app, so this step is yours.";
/** A lookup plus a local-model plan; past this, the Hode carries on a step at a time without one. */
const PLAN_TIMEOUT_MS = 45_000;
/** A plan called off for the learner's next step is asked for again after it, this many times in all. */
const MAX_PLAN_TRIES = 3;

type PlanEffect = Extract<HodeEffect, { type: "planOpenGoal" }>;
const POINTER_POLL_MS = 150;
/** Still this long after moving, the pointer has come to rest on where the learner is working. */
const POINTER_REST_MS = 600;
const POINTER_STILL_PX = 12;
/** It must move this far from where it was when Hodey asked: a pointer that never moved says nothing new. */
const POINTER_MOVED_PX = 24;
/** A question nobody answers with the pointer stops being watched after this long. */
const POINTER_WATCH_MAX_MS = 60_000;

const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/** Muted, a line counts as said once it's been up this long per word (with a floor), the time to read it. */
const MUTED_READ_MS_PER_WORD = 300;
const MUTED_READ_MIN_MS = 2500;

function readingMs(text: string): number {
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  return Math.max(MUTED_READ_MIN_MS, words * MUTED_READ_MS_PER_WORD);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HodeRuntime {
  private state: HodeState = initialState;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void>;
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private speech: AbortController | undefined;
  /** Skill writes are chained so the next step's read sees the previous step's outcome. */
  private pendingWrite: Promise<void> = Promise.resolve();
  /** Hodey's last few lines, newest last; `endedAt` unset while still being said. */
  private recentLines: Array<{ text: string; endedAt: number | undefined }> = [];
  private readonly speechFinishedListeners = new Set<() => void>();
  private focusing: Promise<void> = Promise.resolve();
  private muted = false;
  /** The learner's default mode, used when a goal arrives without one. */
  private defaultMode: HodeMode = "teach";
  private defaultAgentStyle: AgentStyle = "guide";
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private readTimer: ReturnType<typeof setTimeout> | undefined;
  private stuckMs: number | undefined;
  private autoLanguage = false;
  private pointerWatch: ReturnType<typeof setInterval> | undefined;
  /** The plan being made; llama-server serves one request at a time, so it gives way to the next step. */
  private planning: { effect: PlanEffect; controller: AbortController; tries: number } | undefined;
  /** A plan that gave way to a step, asked for again once that step is answered. */
  private deferredPlan: { effect: PlanEffect; tries: number } | undefined;
  /** A pointer that can't be read is logged once, not on every request. */
  private pointerFailed = false;
  /** What learning memory recalled for the running Hode; skill loads wait for it. */
  private recalled: Promise<LearningMemory[]> = Promise.resolve([]);
  private readonly transitionListeners = new Set<(event: HodeEvent, prev: HodeState, next: HodeState) => void>();
  /** The reasoning in flight, called off as soon as the Hode's request id moves past it. */
  private reasoning: { requestId: number; controller: AbortController } | undefined;
  /** The app an open goal turned out to be about (a pack or a named app sets `state.app` instead). */
  private hodeApp: string | undefined;
  /** The learner is in another app while the Hode's app waits behind it. */
  private away = false;
  /** Window switches the watcher has reported, so an app being opened can tell whether one came meanwhile. */
  private watchedSwitches = 0;
  /** Hodey's own report that an app it opened is up, waiting out the watcher's grace period. */
  private openedSwitch: ReturnType<typeof setTimeout> | undefined;
  /** The step's controls perception was last told, for its reads after the learner's own actions. */
  private wanted: string[] = [];

  constructor(private readonly deps: RuntimeDeps) {
    this.disposers = [
      // What the learner does in another app (while the Hode's app waits behind it) isn't part of the Hode.
      deps.perception.onLearnerAction((observation) => (this.away ? undefined : this.dispatch({ type: "LEARNER_ACTED", observation }))),
      deps.bus.on("annotate:start", () => this.dispatch({ type: "ANNOTATE_START" })),
      deps.bus.on("annotate:cancel", () => this.dispatch({ type: "ANNOTATE_CANCEL" })),
      deps.bus.on("annotation:submitted", ({ annotation }) => this.submitAnnotation(annotation)),
      deps.perception.onAppSwitched?.((window) => this.watcherSawSwitch(window)) ?? (() => undefined),
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
    const event = withDefaults(incoming, this.defaultMode, this.defaultAgentStyle);
    const prev = this.state;
    const { state, effects } = step(prev, event);
    if (event.type === "GOAL_SUBMITTED" && prev.phase === "goal_entry" && state.pack) this.recall(state);
    if (state !== prev) {
      this.state = state;
      if (state.phase === "idle") this.forgetHodeApp();
      this.abandonStaleReasoning();
      this.shareWanted();
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
    const heard = this.autoLanguage ? detectLanguage(text) : undefined;
    if (heard) this.setLanguage(heard);
  }

  private setLanguage(language: ReplyLanguage): void {
    if (language !== this.state.language) this.dispatch({ type: "SET_LANGUAGE", language });
  }

  /** Barge-in: the learner started talking, so Hodey stops mid-sentence. */
  interruptSpeech(): void {
    this.stopSpeech();
    this.answerCutShort();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) return;
    this.stopSpeech();
    this.answerCutShort();
  }

  /** The learner stopped Hodey mid-answer: the answer counts as delivered, so its card can fold away. */
  private answerCutShort(): void {
    if (this.state.phase === "answering" && this.state.answerSaid === false) this.dispatch({ type: "SPEECH_FINISHED" });
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.clearStuckTimer();
    this.clearPressTimer();
    this.clearOpenedSwitch();
    this.stopPointerWatch();
    this.planning?.controller.abort();
    this.stopSpeech();
    this.wanted = [];
    this.deps.perception.setWanted?.([]);
  }

  /** Reads after the learner's own actions look for the current step's controls too (see `wantedNames`). */
  private shareWanted(): void {
    const names = wantedNames(this.state);
    if (sameNames(names, this.wanted)) return;
    this.wanted = names;
    this.deps.perception.setWanted?.(names);
  }

  private run(effect: HodeEffect): void {
    switch (effect.type) {
      case "focusApp":
        return this.focusApp(effect.app, effect.launch);
      case "loadSkill":
        return this.loadSkill(effect.skillId);
      case "observe":
        return this.observe(effect.region);
      case "reason":
        return this.reason(effect.requestId, effect.context);
      case "perform":
        return this.schedulePress(effect.requestId, effect.request, effect.delayMs);
      case "renderOverlay":
        return this.renderOverlay(effect.primitives, effect.screen === true);
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
      case "launchApp":
        return this.openApp(effect.app);
      case "observeShell":
        return this.observeShell();
      case "planOpenGoal":
        return this.planOpenGoal(effect);
      case "watchPointer":
        return this.watchPointer();
    }
  }

  /** Hodey is asking where the learner is working (a clarify on screen). */
  private clarifying(): boolean {
    return this.state.phase === "guiding" && this.state.action?.kind === "clarify";
  }

  /** While Hodey asks where the learner is working, a pointer moved somewhere and rested there is the answer. */
  private watchPointer(): void {
    if (!this.deps.pointer || this.pointerWatch) return;
    const started = Date.now();
    let origin: Point | undefined;
    let still: { at: Point; since: number } | undefined;
    const tick = async () => {
      if (!this.clarifying() || Date.now() - started > POINTER_WATCH_MAX_MS) return this.stopPointerWatch();
      const at = await this.readPointer();
      if (!at) return this.stopPointerWatch();
      origin ??= at;
      if (!still || apart(at, still.at) > POINTER_STILL_PX) {
        still = { at, since: Date.now() };
        return;
      }
      if (apart(at, origin) <= POINTER_MOVED_PX || Date.now() - still.since < POINTER_REST_MS) return;
      this.stopPointerWatch();
      if (this.clarifying()) this.dispatch({ type: "POINTER_RESTED" });
    };
    this.pointerWatch = setInterval(() => void tick(), POINTER_POLL_MS);
  }

  private stopPointerWatch(): void {
    clearInterval(this.pointerWatch);
    this.pointerWatch = undefined;
  }

  /** The pointer, or undefined when it can't be read (logged once, not on every read). */
  private async readPointer(): Promise<Point | undefined> {
    if (!this.deps.pointer) return undefined;
    try {
      return await this.deps.pointer();
    } catch (error) {
      if (!this.pointerFailed) console.error("Couldn't read the pointer; Hodey works without it", error);
      this.pointerFailed = true;
      return undefined;
    }
  }

  /** Every request carries the pointer: it usually rests near what the learner is working on. */
  private async withPointer(context: TeachingContext): Promise<TeachingContext> {
    const pointer = await this.readPointer();
    return pointer ? { ...context, pointer } : context;
  }

  /**
   * Plans an open Hode in the background: reference steps first (the offline help, and the web when Settings
   * allows it), then the local model. A failed plan is logged, and the Hode carries on a step at a time.
   */
  private planOpenGoal(effect: PlanEffect, tries = 1): void {
    const planner = this.deps.planner;
    if (!planner) return;
    const { planId, goal, app, language } = effect;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PLAN_TIMEOUT_MS)]);
    this.planning = { effect, controller, tries };
    this.planReference(goal, app, signal)
      .then((reference) => planner.plan({ goal, app, reference, language }, signal))
      .finally(() => {
        if (this.planning?.controller === controller) this.planning = undefined;
      })
      .then(
        (plan) => this.dispatch({ type: "PLAN_READY", planId, goal, plan }),
        (error: unknown) => {
          // Given way to the learner's next step: it's asked for again after that.
          if (!controller.signal.aborted) console.error("Couldn't plan the Hode; Hodey plans it a step at a time", error);
        },
      );
  }

  /** The learner's next step comes first: the plan gives way (the model takes one request at a time) and waits. */
  private yieldPlan(): void {
    const planning = this.planning;
    if (!planning) return;
    planning.controller.abort();
    this.planning = undefined;
    this.deferredPlan = planning.tries < MAX_PLAN_TRIES ? { effect: planning.effect, tries: planning.tries + 1 } : undefined;
  }

  /** Once a step is answered, a plan that gave way to it is asked for again, if it's still this Hode's and still wanted. */
  private resumePlan(): void {
    const deferred = this.deferredPlan;
    if (!deferred || this.reasoning) return;
    this.deferredPlan = undefined;
    if (this.state.planId !== deferred.effect.planId || this.state.plan !== undefined) return;
    this.planOpenGoal(deferred.effect, deferred.tries);
  }

  /** Reference steps for planning a goal; without them (none found, or the lookup failed) the model plans from what it knows. */
  private async planReference(goal: string, app: string | undefined, signal: AbortSignal): Promise<string | undefined> {
    if (!this.deps.planReference) return undefined;
    try {
      return await this.deps.planReference(goal, app, signal);
    } catch (error) {
      console.error("Looking up the goal failed; Hodey plans it from what it knows", error);
      return undefined;
    }
  }

  /** Whether the learner stepped into another app while the Hode's app waits behind it. */
  isAway(): boolean {
    return this.away;
  }

  /**
   * Another window came forward: the reducer decides what it means. During a Hode it's told whether that's
   * another app than the one being taught (`away`), so the Hode waits quietly instead of asking them back.
   */
  private appSwitched(window: AppSwitch = {}): void {
    const away = this.awayFrom(window);
    this.away = away === true;
    this.dispatch(away === undefined ? { type: "APP_SWITCHED" } : { type: "APP_SWITCHED", away });
  }

  /**
   * Another app than the Hode's (undefined outside a Hode, when either app is unknown, or without a window watcher:
   * nothing would ever say the learner came back).
   */
  private awayFrom(window: AppSwitch): boolean | undefined {
    const app = this.state.app ?? this.hodeApp;
    if (!this.deps.perception.onAppSwitched || this.state.phase === "idle" || app === undefined || !window.app) return undefined;
    return !sameApp(window.app, app);
  }

  private forgetHodeApp(): void {
    this.hodeApp = undefined;
    this.away = false;
  }

  /** An open goal may name no app: the first app read during the Hode is the one it teaches. */
  private pin(observation: ScreenObservation): void {
    if (this.state.phase !== "idle" && this.state.app === undefined && this.hodeApp === undefined && observation.app) this.hodeApp = observation.app;
  }

  /** The window watcher saw another window come forward, which covers an app Hodey has just opened too. */
  private watcherSawSwitch(window: AppSwitch = {}): void {
    this.watchedSwitches += 1;
    this.clearOpenedSwitch();
    this.appSwitched(window);
  }

  /**
   * An app Hodey opened is up. The window watcher usually reports its window coming forward, while it opened or
   * just after; Hodey reports the switch itself only when the watcher said nothing by the end of the grace period
   * (or nothing watches), so the reducer hears of it once.
   */
  private openedAppIsUp(watchedAtStart: number, app: string): void {
    if (!this.deps.perception.onAppSwitched) return this.appSwitched({ app });
    if (this.watchedSwitches !== watchedAtStart) return;
    this.clearOpenedSwitch();
    this.openedSwitch = setTimeout(() => {
      this.openedSwitch = undefined;
      this.appSwitched({ app });
    }, NATIVE_SWITCH_GRACE_MS);
  }

  private clearOpenedSwitch(): void {
    if (this.openedSwitch !== undefined) clearTimeout(this.openedSwitch);
    this.openedSwitch = undefined;
  }

  /** The taskbar's Start button and search box, for a Hode waiting on an app; always answered, empty when unreadable. */
  private observeShell(): void {
    observeShellTargets(this.deps.perception).then((elements) => this.dispatch({ type: "SHELL_OBSERVED", elements }));
  }

  /** Opens an installed app the learner asked for; a Hode waiting for it carries on as soon as it's up. */
  private openApp(app: InstalledApp): void {
    const failed = (reason: string) => this.dispatch({ type: "APP_OPEN_FAILED", app, reason });
    const watchedAtStart = this.watchedSwitches;
    const open = this.deps.perception.openInstalledApp?.(app.id) ?? Promise.reject(new Error("Opening apps isn't available here"));
    withTimeout(open, OPEN_APP_TIMEOUT_MS, `${app.name} didn't open in time`).then(
      (appeared) => {
        if (!appeared) return failed(`No ${app.name} window appeared`);
        this.openedAppIsUp(watchedAtStart, app.name);
      },
      (error) => {
        console.error(`Couldn't open ${app.name}`, error);
        failed(errorMessage(error));
      },
    );
  }

  /** Desktop guidance belongs to the window it was placed on, the one last read; the overlay draws it only there. */
  /** A mark on the mirrored iPhone becomes a question about the phone, in its frame's pixels. */
  private submitAnnotation(annotation: LearnerAnnotation): void {
    const place = this.deps.placeAnnotation ?? ((a: LearnerAnnotation) => Promise.resolve(a));
    place(annotation)
      .catch((error) => {
        console.error("Couldn't tell whether Point & Ask was on the iPhone; reading the desktop", error);
        return annotation;
      })
      .then((placed) => this.dispatch({ type: "ANNOTATION_SUBMITTED", annotation: placed }));
  }

  private renderOverlay(primitives: OverlayPrimitive[], screen = false): void {
    const surface = this.state.pack?.surface ?? this.state.question?.surface ?? "windows";
    // Screen-wide guidance (the taskbar's search box) isn't clipped to the learner's window.
    const anchor = surface === "windows" && !screen ? this.state.observation?.window : undefined;
    this.deps.bus.emit("overlay:render", anchor ? { primitives, surface, anchor } : { primitives, surface });
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
  private focusApp(app: string, launch?: AppLaunch): void {
    const { perception } = this.deps;
    const focus = (launch && perception.launchApp?.(app, launch)) || (perception.focusApp?.(app) ?? Promise.resolve(false));
    this.focusing = focus.then(
      (found) => {
        if (!found) console.info(`No ${app} window is open yet; Hodey will ask the learner to open it`);
      },
      (error) => console.error(`Couldn't bring ${app} forward`, error),
    );
  }

  /** A read for the state that asked for it, looking for that step's controls. */
  private observe(region?: Rect): void {
    const want = wantedNames(this.state);
    this.focusing.then(() => this.deps.perception.observe(region, want)).then(
      (observation) => {
        this.pin(observation);
        this.dispatch({ type: "OBSERVED", observation });
      },
      (error) => this.fail("Couldn't read the screen", error),
    );
  }

  private reason(requestId: number, context: TeachingContext): void {
    this.reasoning?.controller.abort();
    this.yieldPlan();
    const controller = new AbortController();
    this.reasoning = { requestId, controller };
    const hooks = { onThinking: () => this.dispatch({ type: "THINKING", requestId }), signal: controller.signal };
    this.withReference(context, controller.signal)
      .then((referenced) => this.withPointer(referenced))
      .then((pointed) => reasonWithFallback(this.deps.reasoners, pointed, hooks))
      .finally(() => {
        if (this.reasoning?.controller === controller) this.reasoning = undefined;
      })
      .then(
        ({ action, failures }) => {
          // Backstop: an answer to a request that was called off never reaches the Hode.
          if (controller.signal.aborted) return;
          this.dispatch({ type: "ACTION_READY", requestId, action, failures });
          this.resumePlan();
        },
        (error) => {
          // Called off because the Hode moved on: nothing failed.
          if (!controller.signal.aborted) this.fail("Hodey couldn't work out the next step", error, requestId);
        },
      );
  }

  /**
   * A spoken question (not Point & Ask) gets the offline help's steps first, and the web's only when the
   * context says to look it up; a failed lookup is answered without them.
   */
  private async withReference(context: TeachingContext, signal: AbortSignal): Promise<TeachingContext> {
    const question = context.utterance;
    if (!this.deps.reference || !question || context.focusRegion?.intent === "ask") return context;
    try {
      const reference = await this.deps.reference(question, context.observation.app, signal, { web: context.lookUp === true });
      return reference ? { ...context, reference } : context;
    } catch (error) {
      if (!signal.aborted) console.error("Looking up the question failed; Hodey answers from the screen", error);
      return context;
    }
  }

  /** A newer request, a pause or the end of the Hode: stop the reasoning (and the model) working on an old one. */
  private abandonStaleReasoning(): void {
    if (!this.reasoning || this.reasoning.requestId === this.state.requestId) return;
    this.reasoning.controller.abort();
    this.reasoning = undefined;
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
      .then(() => perception.observe(undefined, wantedNames(this.state)))
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
    this.clearReadTimer();
    if (this.muted) {
      this.readTimer = setTimeout(() => {
        this.readTimer = undefined;
        this.dispatch({ type: "SPEECH_FINISHED" });
      }, readingMs(text));
      return;
    }
    this.speech?.abort();
    const controller = new AbortController();
    this.speech = controller;
    const saying = { text, endedAt: undefined as number | undefined };
    this.recentLines = [...this.recentLines, saying].slice(-ECHO_LINES);
    this.deps.tts
      .speak(once(text), controller.signal)
      .then(
        () => {
          saying.endedAt = Date.now();
          if (controller.signal.aborted) return;
          this.dispatch({ type: "SPEECH_FINISHED" });
          this.speechFinishedListeners.forEach((listener) => listener());
        },
        (error) => {
          saying.endedAt = Date.now();
          if (controller.signal.aborted) return;
          console.error("Speech failed", error);
          // The line is on the card even if it couldn't be heard.
          this.dispatch({ type: "SPEECH_FINISHED" });
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

  /** What Hodey is saying, or said moments ago (its voice can still be echoing back through the mic): its last two lines. */
  hodeySaying(): string | undefined {
    const now = Date.now();
    const live = this.recentLines.filter(({ endedAt }) => endedAt === undefined || now - endedAt < ECHO_WINDOW_MS);
    return live.length > 0 ? live.map(({ text }) => text).join(" ") : undefined;
  }

  private clearReadTimer(): void {
    if (this.readTimer !== undefined) clearTimeout(this.readTimer);
    this.readTimer = undefined;
  }

  private stopSpeech(): void {
    this.clearReadTimer();
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

/** A goal, or an app opened from idle, takes the learner's default mode (and style) unless it names its own. */
function withDefaults(event: HodeEvent, mode: HodeMode, agentStyle: AgentStyle): HodeEvent {
  if (event.type === "GOAL_SUBMITTED") return { ...event, mode: event.mode ?? mode, agentStyle: event.agentStyle ?? agentStyle };
  if (event.type === "OPEN_APP") return { ...event, mode: event.mode ?? mode };
  return event;
}

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Rejects with `message` if `work` hasn't settled in `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The learner's own words in an event, for detecting their language. */
function learnerWords(event: HodeEvent): string | undefined {
  if (event.type === "GOAL_SUBMITTED") return event.goal;
  if (event.type === "OPEN_APP") return event.said;
  if (event.type === "VOICE_QUESTION") return event.question;
  if (event.type === "ANNOTATION_SUBMITTED") return event.annotation.question;
  return undefined;
}
