import { emit, listen } from "@tauri-apps/api/event";
import type { Bus, BusEventName, BusEvents, BusHandler } from "./bus";
import { reportError } from "./errors";

/** Subscribes to a Tauri event and returns a synchronous unsubscribe. */
export function subscribeTauri<T>(event: string, handler: (payload: T) => void): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;
  listen<T>(event, (e) => handler(e.payload))
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(reportError(`Couldn't listen for ${event}`));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Cross-window bus backed by Tauri events (delivered to every window, including the sender). */
export class TauriBus implements Bus {
  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
    emit(name, payload).catch(reportError(`Couldn't emit ${name}`));
  }

  on<K extends BusEventName>(name: K, handler: BusHandler<K>): () => void {
    return subscribeTauri<BusEvents[K]>(name, handler);
  }
}
