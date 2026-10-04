import { spoken } from "../../lib/spoken";
import type { InstalledApp } from "../../lib/types";
import { resolveApp } from "../apps/resolve";
import { appQuery } from "../voice/intent";
import { noop, type EventOf, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";

/** APP_OPEN_FAILED reasons that aren't Windows failing to open it. */
export const APP_NOT_FOUND = "not_found";
export const APP_AMBIGUOUS = "ambiguous";

const noHode = (s: HodeState) => s.phase === "idle" || s.phase === "goal_entry";

/** "Open Excel" as OPEN_APP when exactly one installed app fits the name; otherwise it isn't an app request. */
export function openAppEvent(text: string, apps: InstalledApp[]): HodeEvent | undefined {
  const query = appQuery(text);
  if (query === undefined || apps.length === 0) return undefined;
  const found = resolveApp(query, apps);
  return found.kind === "match" ? { type: "OPEN_APP", app: found.app, said: text } : undefined;
}

/**
 * With no Hode running, an app request that names several apps asks which one; one that names none says so
 * when the vision model can't take it as a task instead (it may be a website: "open YouTube").
 */
export function idleOpenAppEvent(text: string, apps: InstalledApp[], openAllowed: boolean): HodeEvent | undefined {
  const query = appQuery(text);
  if (query === undefined || apps.length === 0) return undefined;
  const found = resolveApp(query, apps);
  if (found.kind === "match") return { type: "OPEN_APP", app: found.app, said: text };
  if (found.kind === "ambiguous") return { type: "APP_OPEN_FAILED", app: found.options[0], reason: APP_AMBIGUOUS, options: found.options.map((app) => app.name) };
  const oneWord = !query.includes(" ");
  return oneWord && !openAllowed ? { type: "APP_OPEN_FAILED", app: { id: "", name: query, kind: "desktop" }, reason: APP_NOT_FOUND } : undefined;
}

/**
 * Opens the app: from idle (closing the goal form), or as a side errand that leaves a running Hode's step alone.
 * A Hode waiting for that app carries on when its window comes forward (the runtime's app-switch check).
 */
export function onOpenApp(s: HodeState, e: EventOf<"OPEN_APP">): Transition {
  if (s.phase === "annotating") return noop(s);
  const idle = noHode(s);
  const mode = idle ? (e.mode ?? s.mode) : s.mode;
  const words = spoken(s.language);
  // Teach mode: opening apps is a skill too, so Hodey says how to do it without asking next time.
  const line = mode === "teach" ? `${words.opening(e.app.name)} ${words.openTip}` : words.opening(e.app.name);
  const effects: HodeEffect[] = [{ type: "say", text: line }, { type: "launchApp", app: e.app }];
  return { state: idle ? { ...s, phase: "idle", notice: line } : s, effects };
}

function failureLine(s: HodeState, e: EventOf<"APP_OPEN_FAILED">): string {
  const words = spoken(s.language);
  if (e.reason === APP_NOT_FOUND) return words.appNotFound(e.app.name);
  if (e.reason === APP_AMBIGUOUS) return words.appWhich(e.options ?? [e.app.name]);
  return words.openFailed(e.app.name);
}

/** Says why the app didn't open; shown on the card too when no Hode's guidance is there. */
export function onAppOpenFailed(s: HodeState, e: EventOf<"APP_OPEN_FAILED">): Transition {
  if (s.phase === "annotating") return noop(s);
  const line = failureLine(s, e);
  return { state: noHode(s) ? { ...s, notice: line } : s, effects: [{ type: "say", text: line }] };
}
