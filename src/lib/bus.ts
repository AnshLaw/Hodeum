import type { ActivityChannel } from "./activity";
import type { AccountStatus } from "../features/account/types";
import type { AppPresence, DockPrefs } from "../features/dock/dock";
import type { LearnerAnnotation, OverlayPrimitive, Rect, Surface } from "./types";
import type { WebProgress } from "../providers/web/types";

type Empty = Record<string, never>;

export interface BusEvents {
  /** Highlights for one surface; absent means the Windows desktop. The notch draws "phone" ones on the mirror. */
  "overlay:render": { primitives: OverlayPrimitive[]; surface?: Surface };
  "overlay:clear": Empty;
  /** Where the notch surface is right now (physical screen px), so the overlay keeps arrows and labels out from under it. */
  "notch:rect": { rect: Rect };
  /** Ask the notch to report its rect (the overlay just loaded). */
  "notch:rect-request": Empty;
  "annotate:start": Empty;
  "annotate:cancel": Empty;
  "annotation:submitted": { annotation: LearnerAnnotation };
  /** Local data changed (a Hode was logged, settings saved, a skill adjusted); views refresh. */
  "data:changed": Empty;
  "settings:changed": Empty;
  /** A cloud API key was saved or removed in Settings (the key itself never crosses the bus). */
  "cloud:keys-changed": Empty;
  /** Live Hode status from the notch (where the runtime lives) for the app window. */
  "hode:summary": HodeSummary;
  /** Ask the notch to start a Hode, e.g. from the app's chat or learning paths. */
  "hode:start": { goal: string };
  "hode:end": Empty;
  /** Ask the notch to broadcast a fresh summary (an app window just opened). */
  "hode:summary-request": Empty;
  /** Another window (the app) is using a privacy channel; the notch shows its dot. */
  "activity:remote": { id: string; channel: ActivityChannel; active: boolean };
  /** A web search from Ask Hodey (in the app), shown on the notch so the learner sees what leaves the PC. */
  "web:search": WebProgress;
  /** Stop the web search and answer in progress (the notch's Stop). */
  "web:cancel": Empty;
  /** Where Hodey lives, broadcast by the notch (which owns it) whenever it changes or is asked. */
  "dock:prefs": DockPrefs;
  "dock:prefs-request": Empty;
  /** Ask the notch to move or restyle Hodey, e.g. from the app's settings. */
  "dock:change": Partial<DockPrefs>;
  /** The Hodeum app is on screen, folding back into the notch, or gone; and whether the learner is in it. */
  "app:presence": { presence: AppPresence; focused: boolean };
  /** Sign-in and sync state, broadcast by the notch (which owns the account) whenever it changes or is asked. */
  "account:status": AccountStatus;
  "account:status-request": Empty;
  "account:sign-in": Empty;
  /** Stop waiting for the browser (the learner closed the tab). */
  "account:cancel": Empty;
  "account:sign-out": Empty;
  "account:pause": { paused: boolean };
  /** Sync now and re-announce this PC to the web dashboard, after a failure. */
  "account:retry": Empty;
  /** A row was deleted locally; sync deletes it in the cloud too instead of pulling it back. */
  "sync:deleted": { table: "skills" | "chats"; id: string };
}

export interface HodeSummary {
  phase: string;
  goal: string;
  /** What Hodey is currently saying or asking. */
  title: string;
  step?: { current: number; total: number };
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
