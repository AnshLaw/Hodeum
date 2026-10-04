import type { TaskPack } from "../../lib/types";
import { goalEvent } from "../hode/bridge";
import type { HodeEvent, HodeState } from "../hode/model";

/** Said before a command or question; dropped before matching. */
const WAKE = /^(?:hey |ok |okay )?hod[e]?y[,!.]?\s*/i;
const POLITE = /\b(?:please|thanks|thank you|can you|could you)\b/gi;
/** Utterances shorter than this (after cleanup) are noise: "um", "uh". */
const MIN_CHARS = 3;
const QUESTION_START = /^(?:what|where|which|why|who|whose|when|is|are|does|did|was|were|can i see|what's|where's)\b/i;

/** Spoken controls during a Hode. Matched against the whole cleaned utterance, so questions aren't misread. */
const COMMANDS: [RegExp, HodeEvent][] = [
  [/^(?:(?:give me )?a hint|hint|help(?: me)?|i'?m stuck|i am stuck)$/, { type: "HINT_REQUESTED" }],
  [/^(?:explain(?: that| this)?|why)$/, { type: "EXPLAIN_REQUESTED" }],
  [/^(?:repeat(?: that)?|say (?:that|it) again|again|what did you say)$/, { type: "REPEAT" }],
  [/^(?:look again|check again|i did it|done|i'?m done|finished)$/, { type: "LOOK_AGAIN" }],
  [/^(?:let me try|i'?ll try|i will try)$/, { type: "LET_ME_TRY" }],
  [/^(?:pause|wait|hold on)$/, { type: "PAUSE" }],
  [/^(?:resume|continue|go on|keep going|carry on)$/, { type: "RESUME" }],
  [/^(?:stop|end|cancel|quit|end (?:the )?hode|stop (?:the )?hode)$/, { type: "END_HODE" }],
  [/^(?:ok|okay|got it|cool|understood|alright|all right)$/, { type: "DISMISS" }],
];

function clean(text: string): string {
  return text.trim().replace(WAKE, "").trim();
}

function asCommand(text: string): HodeEvent | undefined {
  const bare = text.toLowerCase().replace(POLITE, " ").replace(/[^\w' ]/g, " ").replace(/\s+/g, " ").trim();
  return COMMANDS.find(([pattern]) => pattern.test(bare))?.[1];
}

const question = (text: string): HodeEvent => ({ type: "VOICE_QUESTION", question: text });

/**
 * What the learner said, as Hode events. Idle: a goal starts a Hode, a what/where question asks about
 * the screen. Goal entry: it's the goal. During a Hode: a control word, or else a question.
 */
export function routeUtterance(s: HodeState, raw: string, packs: TaskPack[], openAllowed: boolean): HodeEvent[] {
  const text = clean(raw);
  if (text.length < MIN_CHARS) return [];
  if (s.phase === "goal_entry") return [goalEvent(text, packs, openAllowed)];
  if (s.phase === "annotating") return [];
  if (s.phase !== "idle") {
    const command = asCommand(text);
    return [command ?? question(text)];
  }
  if (QUESTION_START.test(text)) return [question(text)];
  const goal = goalEvent(text, packs, openAllowed);
  const startable = goal.type === "GOAL_SUBMITTED" && (goal.pack !== undefined || openAllowed);
  return startable ? [{ type: "START_HODE" }, goal] : [question(text)];
}
