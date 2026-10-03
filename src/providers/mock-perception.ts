import { intersects } from "../lib/coords";
import type { Rect, ScreenObservation, UiElement } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

export type MouseButton = "left" | "right";

export interface MockScene {
  app: string;
  windowTitle: string;
  /** In paint order: containers before their children. */
  elements: UiElement[];
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

  constructor(private readonly currentApp: () => MockApp) {}

  async observe(region?: Rect): Promise<ScreenObservation> {
    return this.snapshot(region);
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Call after the learner interacts with the mock app. */
  notifyLearnerAction(): void {
    const observation = this.snapshot();
    this.handlers.forEach((handler) => handler(observation));
  }

  private snapshot(region?: Rect): ScreenObservation {
    const scene = this.currentApp().snapshot();
    const elements = region ? scene.elements.filter((e) => intersects(e.bounds, region)) : scene.elements;
    return { app: scene.app, windowTitle: scene.windowTitle, elements, at: Date.now() };
  }
}
