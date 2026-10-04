import { spoken } from "../../lib/spoken";
import { onGoalSubmitted } from "./flow";
import { initialState, noop, type EventOf, type HodeState, type Transition } from "./model";

/**
 * How a Hode ends (docs/teach-loop.md). Teach recaps the moves and asks one recall question; a
 * practice round runs the same lesson again with Hodey only watching.
 */

/** Ordinal answers ("the first one", "number two"), by option index. */
const ORDINALS = [/\b(?:first|one|1)\b/, /\b(?:second|two|2)\b/, /\b(?:third|three|3)\b/, /\b(?:fourth|four|4)\b/];
/** A spoken answer names an option when it holds at least this share of the option's words. */
const MIN_WORDS_HEARD = 0.5;
/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently, so it's ignored. */
const NUKTA = /़/g;

const wordsOf = (text: string): string[] =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(NUKTA, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The option a spoken answer names: by its words, or by its place ("the first one"). */
export function optionSaid(options: string[], said: string): number | undefined {
  const heard = new Set(wordsOf(said));
  const scored = options.map((option, index) => {
    const words = wordsOf(option);
    return { index, share: words.filter((word) => heard.has(word)).length / Math.max(words.length, 1) };
  });
  const best = scored.filter((s) => s.share >= MIN_WORDS_HEARD).sort((a, b) => b.share - a.share)[0];
  if (best) return best.index;
  const ordinal = ORDINALS.findIndex((pattern) => pattern.test([...heard].join(" ")));
  return ordinal >= 0 && ordinal < options.length ? ordinal : undefined;
}

/**
 * The line that ends a Hode. Teach says the moves in one line and asks its recall question; a practice
 * round done without help says so instead of asking again.
 */
export function finishHode(s: HodeState): Transition {
  const words = spoken(s.language);
  const teach = s.mode === "teach";
  const check = teach && !s.practice ? s.pack?.check : undefined;
  const opener = s.practice && !s.neededHelp ? words.didItAlone : words.hodeCompleteSpeech;
  const line = [opener, teach ? s.pack?.recap : undefined, check?.question].filter((part): part is string => part !== undefined && part !== "").join(" ");
  return {
    state: { ...s, phase: "success", action: undefined, review: check ? { check } : undefined },
    effects: [{ type: "say", text: line }],
  };
}

/** The learner's answer to the recall question: confirmed, or put right kindly, with the idea behind it. */
export function onReviewAnswered(s: HodeState, e: EventOf<"REVIEW_ANSWERED">): Transition {
  const review = s.review;
  if (s.phase !== "success" || !review || review.picked !== undefined) return noop(s);
  const { check } = review;
  const words = spoken(s.language);
  const picked = e.option ?? (e.said === undefined ? undefined : optionSaid(check.options, e.said));
  if (picked === undefined || picked < 0 || picked >= check.options.length) return { state: s, effects: [{ type: "say", text: words.pickAnAnswer }] };
  const verdict = picked === check.answer ? words.reviewRight[0] : words.reviewWrong(check.options[check.answer]);
  return { state: { ...s, review: { ...review, picked } }, effects: [{ type: "say", text: `${verdict} ${check.explain}` }] };
}

/** "Practise on your own": the same lesson from the top, every step watched rather than prompted. */
export function onPracticeAgain(s: HodeState): Transition {
  if (s.phase !== "success" || !s.pack || s.open) return noop(s);
  const fresh: HodeState = { ...initialState, phase: "goal_entry", language: s.language, focusRegion: s.focusRegion };
  const begun = onGoalSubmitted(fresh, { type: "GOAL_SUBMITTED", goal: s.goal, pack: s.pack, mode: "teach" });
  return { ...begun, state: { ...begun.state, practice: true, pendingIntro: spoken(s.language).practiceIntro } };
}
