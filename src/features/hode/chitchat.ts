import { spoken } from "../../lib/spoken";
import { noop, type EventOf, type HodeState, type Transition } from "./model";

/**
 * Small talk with no Hode running: a greeting gets a friendly reply, anything else that isn't a task a nudge
 * to name one. Every reply is said and takes the card's place, the same one again too: a second "hello" is
 * answered as well (Hodey's own voice coming back through the mic is filtered out before it gets here).
 */
export function onChitchat(s: HodeState, e: EventOf<"CHITCHAT">): Transition {
  if (s.phase !== "idle" && s.phase !== "goal_entry") return noop(s);
  const words = spoken(s.language);
  const line = e.kind === "greeting" ? words.greeting : words.notATask;
  // The reply takes the card's place, and with it any "Did you mean …?" still waiting for an answer.
  return { state: { ...s, notice: line, appChoice: undefined }, effects: [{ type: "say", text: line }] };
}
