import type { LearnerAnnotation, OverlayPrimitive } from "./types";

type Empty = Record<string, never>;

export interface BusEvents {
  "overlay:render": { primitives: OverlayPrimitive[] };
  "overlay:clear": Empty;
  "annotate:start": Empty;
  "annotate:cancel": Empty;
  "annotation:submitted": { annotation: LearnerAnnotation };
}

export type BusEventName = keyof BusEvents;
export type BusHandler<K extends BusEventName> = (payload: BusEvents[K]) => void;

/** Typed messages between the notch, the overlay, and the Hode runtime. */
export interface Bus {
  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void;
  on<K extends BusEventName>(name: K, handler: BusHandler<K>): () => void;
}

/** In-page bus for tests and the browser practice stage. */
export class LocalBus implements Bus {
  private readonly handlers = new Map<BusEventName, Set<(payload: unknown) => void>>();

  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(payload);
  }

  on<K extends BusEventName>(name: K, handler: BusHandler<K>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    this.handlers.set(name, set);
    return () => {
      set.delete(wrapped);
    };
  }
}
