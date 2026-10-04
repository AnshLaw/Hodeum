import { spoken } from "../../lib/spoken";
import { noop, type EventOf, type HodeState, type Transition } from "./model";

/**
 * Small talk with no Hode running: a greeting gets a friendly reply, anything else that isn't a task a nudge
 * to name one. Shown on the card too. Said once: the same reply again (an echo, a repeated "hello") stays quiet.
 */
export function onChitchat(s: HodeState, e: EventOf<"CHITCHAT">): Transition {
  if (s.phase !== "idle" && s.phase !== "goal_entry") return noop(s);
  const words = spoken(s.language);
  const line = e.kind === "greeting" ? words.greeting : words.notATask;
  if (s.notice === line) return noop(s);
  return { state: { ...s, notice: line }, effects: [{ type: "say", text: line }] };
}
