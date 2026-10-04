import { intersects } from "../lib/coords";
import type { LearnerInput, Rect, ScreenObservation, ScreenTone, UiElement } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

export type MouseButton = "left" | "right";

export interface MockScene {
  app: string;
  windowTitle: string;
  /** In paint order: containers before their children. */
  elements: UiElement[];
  /** Phone scenes report their brightness, as the OCR mirror does. */
  tone?: ScreenTone;
}

/** A scripted practice app with real state transitions, standing in for UI Automation. */
export interface MockApp {
  readonly id: string;
  readonly label: string;
  snapshot(): MockScene;
  press(elementId: string, button: MouseButton): void;
  reset(): void;
}

export class MockPerception implements PerceptionAdapter {
  private readonly handlers = new Set<(observation: ScreenObservation) => void>();

  /** `latencyMs` mimics a real UI Automation read, so the stage shows Hodey's looking state. */
  constructor(
    private readonly currentApp: () => MockApp,
    private readonly latencyMs = 0,
  ) {}

  async observe(region?: Rect): Promise<ScreenObservation> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return this.snapshot(region);
  }

  /** The stage can't switch apps for the learner: report whether the right practice app is showing. */
  async focusApp(app: string): Promise<boolean> {
    return this.currentApp().label.toLowerCase() === app.toLowerCase();
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Call after the learner interacts with the mock app, with what they did (as the native hook reports it). */
  notifyLearnerAction(inputs: LearnerInput[] = []): void {
    const snapshot = this.snapshot();
    const observation = inputs.length > 0 ? { ...snapshot, inputs } : snapshot;
    this.handlers.forEach((handler) => handler(observation));
  }

  private snapshot(region?: Rect): ScreenObservation {
    const scene = this.currentApp().snapshot();
    const elements = region ? scene.elements.filter((e) => intersects(e.bounds, region)) : scene.elements;
    return { app: scene.app, windowTitle: scene.windowTitle, elements, at: Date.now(), tone: scene.tone };
  }
}
