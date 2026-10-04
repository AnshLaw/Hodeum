import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bus } from "../lib/bus";
import { reportError } from "../lib/errors";
import { subscribeTauri } from "../lib/tauri-bus";
import type { Rect } from "../lib/types";
import { HodeumApp } from "./App";
import { nextPhase, presenceOf, type FrameEvent, type FramePhase } from "./frame";
import type { AppServices, AppWindowControls } from "./services";
import { fold, unfold } from "./unfold";

/** Sent by Rust each time the app is shown: the notch's rect in this window's CSS px, or null. */
const UNFOLD_EVENT = "app:unfold";
/** Sent by Rust when the window is closed natively (Alt+F4, the taskbar) or toggled with the Hodey key + A. */
const FOLD_EVENT = "app:fold";

/** Drives the app window around the notch: unfold on show, fold back before hiding, presence for the notch. */
class FrameController {
  private phase: FramePhase = "hidden";
  private origin: Rect | undefined;
  private animation: Animation | undefined;
  private focused = false;
  private maximized = false;
  private readonly maximizedListeners = new Set<(maximized: boolean) => void>();

  constructor(
    private readonly element: () => HTMLElement | null,
    private readonly win: Window,
    private readonly bus: Bus,
  ) {}

  private step(event: FrameEvent): FramePhase {
    const previous = this.phase;
    this.phase = nextPhase(previous, event);
    if (presenceOf(previous) !== presenceOf(this.phase)) this.announce();
    return previous;
  }

  private announce(): void {
    this.bus.emit("app:presence", { presence: presenceOf(this.phase), focused: this.focused });
  }

  /** Plays `animation`, then `done` unless a newer animation replaced it (a cancel rejects `finished`). */
  private play(animation: Animation, done: () => void): void {
    this.animation?.cancel();
    this.animation = animation;
    animation.finished.then(
      () => this.animation === animation && done(),
      () => undefined, // Cancelled because the learner reopened or closed again mid-way; the newer one takes over.
    );
  }

  show(from: Rect | null): void {
    if (from) this.origin = from;
    this.step("show");
    if (this.phase !== "unfolding") return;
    const element = this.element();
    if (!element) return void this.step("unfolded");
    element.style.opacity = "";
    this.play(unfold(element, this.origin), () => this.step("unfolded"));
  }

  close(): void {
    const previous = this.step("close");
    if (previous === "minimized") return this.hide();
    if (this.phase !== "folding" || previous === "folding") return;
    const element = this.element();
    if (!element) return this.hide();
    this.play(fold(element, this.origin), () => this.hide());
  }

  /** If the window won't hide, it unfolds again rather than sitting invisible over the desktop. */
  private hide(): void {
    this.win.hide().then(
      () => this.step("folded"),
      (error: unknown) => {
        console.error("Couldn't hide the Hodeum window; keeping it open", error);
        this.show(null);
      },
    );
  }

  /** Minimize, restore and maximize all arrive as resizes, whoever caused them (buttons, Win+Up, the taskbar). */
  async sync(): Promise<void> {
    const [minimized, maximized] = await Promise.all([this.win.isMinimized(), this.win.isMaximized()]);
    this.step(minimized ? "minimized" : "restored");
    if (maximized === this.maximized) return;
    this.maximized = maximized;
    this.maximizedListeners.forEach((listener) => listener(maximized));
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.announce();
  }

  controls(): AppWindowControls {
    const report = (what: string) => reportError(`Couldn't ${what} the Hodeum window`);
    return {
      minimize: () => void this.win.minimize().catch(report("minimize")),
      toggleMaximize: () => void this.win.toggleMaximize().catch(report("maximize")),
      close: () => this.close(),
      onMaximizedChange: (listener) => {
        this.maximizedListeners.add(listener);
        listener(this.maximized);
        return () => void this.maximizedListeners.delete(listener);
      },
    };
  }
}

/** A window event subscription with a synchronous unsubscribe, like `subscribeTauri`. */
function subscribeWindow(start: () => Promise<() => void>, what: string): () => void {
  let stop: (() => void) | undefined;
  let disposed = false;
  start().then((unlisten) => (disposed ? unlisten() : (stop = unlisten)), reportError(`Couldn't watch the Hodeum window ${what}`));
  return () => {
    disposed = true;
    stop?.();
  };
}

function useFrameEvents(controller: FrameController, win: Window): void {
  useEffect(() => {
    const sync = () => void controller.sync().catch(reportError("Couldn't read the Hodeum window's state"));
    const offs = [
      subscribeTauri<Rect | null>(UNFOLD_EVENT, (from) => controller.show(from)),
      subscribeTauri<null>(FOLD_EVENT, () => controller.close()),
      subscribeWindow(() => win.onResized(sync), "resizing"),
      subscribeWindow(() => win.onFocusChanged(({ payload }) => (controller.setFocused(payload), sync())), "focus"),
    ];
    return () => offs.forEach((off) => off());
  }, [controller, win]);
}

/** The window grows out of the notch on show and folds back into it before hiding. */
export function NativeFrame({ base }: { base: Omit<AppServices, "window"> }) {
  const frame = useRef<HTMLDivElement>(null);
  const win = useMemo(() => getCurrentWindow(), []);
  const controller = useMemo(() => new FrameController(() => frame.current, win, base.bus), [win, base.bus]);
  const [maximized, setMaximized] = useState(false);
  useFrameEvents(controller, win);
  const services = useMemo<AppServices>(() => ({ ...base, window: controller.controls() }), [base, controller]);
  useEffect(() => services.window.onMaximizedChange?.(setMaximized), [services]);

  return (
    <div ref={frame} className="native-app" data-maximized={maximized} style={{ opacity: 0 }}>
      <HodeumApp services={services} />
    </div>
  );
}
