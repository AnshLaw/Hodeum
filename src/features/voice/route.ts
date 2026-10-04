import type { TaskPack } from "../../lib/types";
import { goalEvent } from "../hode/bridge";
import type { HodeEvent, HodeState } from "../hode/model";

/** Said before a command or question; dropped before matching. Includes how speech recognition
 *  tends to mishear "Hodey" ("body", "howdy", "hodie"). */
const WAKE = /^(?:(?:hey|hi|hello|ok|okay)[ ,]+)?(?:hode?y|hod[iy]e?|hoadie|howdy|body)\b[,!.]?\s*/i;
const POLITE = /\b(?:please|thanks|thank you|can you|could you)\b/gi;
/** Utterances shorter than this (after cleanup) are noise: "um", "uh". */
const MIN_CHARS = 3;
/** A question or goal has at least this many words; a lone word that isn't a control is noise (keyboard clicks). */
const MIN_WORDS = 2;
/** Thanks and okays: they close an answer, and with nothing running they need no reply at all. */
const ACK_WORDS = new Set(["ok", "okay", "great", "perfect", "nice", "cool", "awesome", "alright", "understood", "thanks", "thank", "got"]);
const ACK_FILLER = new Set(["you", "it", "so", "much", "a", "lot", "all", "right", "that", "very"]);
const QUESTION_START = /^(?:what|where|which|why|who|whose|when|is|are|does|did|was|were|can i see|what's|where's)\b/i;

/** Spoken controls during a Hode. Matched against the whole cleaned utterance, so questions aren't misread. */
const COMMANDS: [RegExp, HodeEvent][] = [
  [/^(?:(?:give me )?a hint|hint|help(?: me)?|i'?m stuck|i am stuck)$/, { type: "HINT_REQUESTED" }],
  [/^(?:explain(?: that| this)?|why)$/, { type: "EXPLAIN_REQUESTED" }],
  // "Where?" / "I don't see it" (PRD §7): more help, unlike "wait", which pauses.
  [/^(?:where|where is it|where's it|where is that|i (?:don'?t|do not|can'?t|cannot) (?:see|find) (?:it|that)(?: anywhere)?)$/, { type: "SAID_STUCK" }],
  [/^(?:repeat(?: that)?|say (?:that|it) again|again|what did you say)$/, { type: "REPEAT" }],
  [/^(?:look again|check again|i did it|done|i'?m done|finished)$/, { type: "LOOK_AGAIN" }],
  [/^(?:let me try|i'?ll try|i will try)$/, { type: "LET_ME_TRY" }],
  [/^(?:skip|skip (?:it|this|that|this step|the step)|next step|move on)$/, { type: "SKIP_STEP" }],
  [/^(?:pause|wait|hold on)$/, { type: "PAUSE" }],
  [/^(?:resume|continue|go on|keep going|carry on)$/, { type: "RESUME" }],
  [/^(?:stop|end|cancel|quit|end (?:the )?hode|stop (?:the )?hode)$/, { type: "END_HODE" }],
  [/^(?:ok|okay|got it|cool|understood|alright|all right)$/, { type: "DISMISS" }],
  [/^(?:(?:switch to |go to |use )?teach(?:ing)? mode)$/, { type: "SET_MODE", mode: "teach" }],
  [/^(?:(?:switch to |go to |use )?help mode|just help me if i'?m stuck)$/, { type: "SET_MODE", mode: "help" }],
  [/^(?:(?:switch to |go to |use )?agent mode|(?:guide|walk) me through (?:every|each) step|(?:guide|walk) me through it)$/, { type: "SET_MODE", mode: "agent" }],
  [/^(?:do it(?: for me)?|you do it|do (?:it|this|the clicking) for me|you do the clicking|(?:switch to )?do it for me mode)$/, { type: "SET_AGENT_STYLE", style: "execute" }],
  [/^(?:(?:just )?guide me|i'?ll do the clicking|let me do the clicking)$/, { type: "SET_AGENT_STYLE", style: "guide" }],
  [/^(?:show (?:me )?(?:all )?(?:the )?steps|show (?:me )?all (?:of )?the steps|show (?:me )?the whole (?:flow|thing)|what are the steps)$/, { type: "SHOW_ALL_STEPS" }],
];

/** Hands-free is stricter: the room is always heard, so a mishearing ("body", "howdy") counts only
 *  after a greeting, and Hodey's name alone only in its real spellings. Includes Hindi script ("हे होडी"). */
const HANDS_FREE_WAKE = /^(?:(?:hey|hi|hello|ok|okay)[ ,]+(?:hode?y|hod[iy]e?|hoadie|howdy|body)|hode?y|hod[iy]e?|hoadie|(?:(?:हे|हाय|ओके)[ ,]*)?होडी)(?=[\s,!.?]|$)[,!.?]?\s*/i;

/** The same controls in Hindi and Hinglish, as Hindi speech recognition writes them (in Devanagari). */
const HINDI_COMMANDS: [string, HodeEvent][] = [
  ["हिंट(?: दो| दीजिए| चाहिए)?|संकेत(?: दो| दीजिए)?|मदद(?: करो| कीजिए| चाहिए)?|हेल्प(?: करो)?|मैं (?:फंस|फँस|अटक) (?:गया|गई)", { type: "HINT_REQUESTED" }],
  ["समझाओ|समझाइए|समझाइये|क्यों|एक्सप्लेन करो", { type: "EXPLAIN_REQUESTED" }],
  ["(?:(?:ये|यह|वो|वह) )?(?:कहाँ|कहां|किधर) (?:है|हैं)(?: (?:ये|यह|वो|वह))?|(?:मुझे )?(?:नहीं (?:दिख|मिल) (?:रहा|रही)|(?:दिख|मिल) नहीं (?:रहा|रही))(?: है)?", { type: "SAID_STUCK" }],
  ["(?:फिर से|दोबारा)(?: बोलो| बोलिए| कहो| कहिए)?|रिपीट(?: करो)?|क्या (?:बोला|कहा)", { type: "REPEAT" }],
  ["हो गया|कर दिया|कर लिया|डन|(?:फिर से|दोबारा) देखो", { type: "LOOK_AGAIN" }],
  ["मुझे (?:करने|ट्राई करने) दो|मैं (?:खुद )?(?:करता|करती) ह(?:ूं|ूँ)", { type: "LET_ME_TRY" }],
  ["(?:ये |यह )?(?:स्टेप )?(?:छोड़ो|छोड़ दो|स्किप करो)|अगला स्टेप", { type: "SKIP_STEP" }],
  ["रुको|रुकिए|एक मिनट|पॉज़?(?: करो)?", { type: "PAUSE" }],
  ["आगे बढ़ो|आगे बढ़िए|चलो आगे|जारी रखो|कंटिन्यू(?: करो)?", { type: "RESUME" }],
  ["बंद करो|बंद कीजिए|ख़त्म करो|स्टॉप|बस करो|होड बंद करो", { type: "END_HODE" }],
  ["ठीक है|ओके|समझ (?:गया|गई)|अच्छा", { type: "DISMISS" }],
  ["टीच मोड(?: (?:में|पर) (?:जाओ|चलो))?", { type: "SET_MODE", mode: "teach" }],
  ["हेल्प मोड(?: (?:में|पर) (?:जाओ|चलो))?", { type: "SET_MODE", mode: "help" }],
  ["एजेंट मोड(?: (?:में|पर) (?:जाओ|चलो))?|हर स्टेप (?:में|पर) (?:गाइड करो|बताओ)", { type: "SET_MODE", mode: "agent" }],
  ["(?:आप|तुम|आप ही|तुम ही) कर दो|(?:आप|तुम) कर दीजिए|मेरे लिए कर दो", { type: "SET_AGENT_STYLE", style: "execute" }],
  ["(?:बस )?(?:गाइड|बताते) (?:करो|करते रहो|जाओ)|क्लिक मैं (?:करूंगा|करूँगा|करूंगी|करूँगी)", { type: "SET_AGENT_STYLE", style: "guide" }],
  ["(?:सारे|सभी|पूरे) स्टेप(?:्स)? दिखाओ|पूरा तरीका दिखाओ", { type: "SHOW_ALL_STEPS" }],
];
/** Hinglish controls typed or heard in English letters. */
const ROMAN_HINGLISH: [RegExp, HodeEvent][] = [
  [/^(?:hint (?:do|dijiye|chahiye)|madad (?:karo|kijiye|chahiye)|help karo|main (?:phas|phans|atak) (?:gaya|gayi))$/, { type: "HINT_REQUESTED" }],
  [/^(?:samjhao|samjhaiye|samjhaiye na|explain karo)$/, { type: "EXPLAIN_REQUESTED" }],
  [/^(?:(?:(?:ye|yeh|wo|woh|vo) )?(?:kahan|kahaan|kaha|kidhar) (?:hai|he)(?: (?:ye|yeh|wo|woh|vo))?|(?:mujhe |muje )?(?:(?:nahi|nahin|nai) (?:dikh|mil) (?:raha|rahi)|(?:dikh|mil) (?:nahi|nahin|nai) (?:raha|rahi))(?: hai| he)?)$/, { type: "SAID_STUCK" }],
  [/^(?:(?:phir se|dobara) (?:bolo|boliye|kaho|kahiye)|repeat karo|kya bola|kya kaha)$/, { type: "REPEAT" }],
  [/^(?:ho gaya|kar diya|kar liya|(?:phir se|dobara) dekho)$/, { type: "LOOK_AGAIN" }],
  [/^(?:mujhe (?:karne|try karne) do|main (?:khud )?(?:karta|karti) hoon)$/, { type: "LET_ME_TRY" }],
  [/^(?:(?:ye |yeh )?(?:step )?(?:skip karo|chhod do|chhodo)|agla step)$/, { type: "SKIP_STEP" }],
  [/^(?:ruko|rukiye|ek minute|ek min)$/, { type: "PAUSE" }],
  [/^(?:aage badho|aage badhiye|chalo aage|continue karo)$/, { type: "RESUME" }],
  [/^(?:band karo|band kijiye|khatam karo|bas karo)$/, { type: "END_HODE" }],
  [/^(?:theek hai|thik hai|accha|acha|samajh (?:gaya|gayi))$/, { type: "DISMISS" }],
  [/^(?:(?:aap|tum|aap hi|tum hi) kar do|(?:aap|tum) kar dijiye|mere liye kar do)$/, { type: "SET_AGENT_STYLE", style: "execute" }],
  [/^(?:(?:bas )?guide karo|click main karunga|click main karungi)$/, { type: "SET_AGENT_STYLE", style: "guide" }],
  [/^(?:(?:sare|saare|sabhi|poore) steps dikhao|poora tarika dikhao)$/, { type: "SHOW_ALL_STEPS" }],
];
const POLITE_HINDI =/कृपया|प्लीज़?|ज़रा/g;
/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently, so it's ignored. */
const NUKTA = /\u093C/g;
const withoutNukta = (text: string) => text.normalize("NFC").replace(NUKTA, "");
const HINDI_PATTERNS: [RegExp, HodeEvent][] = HINDI_COMMANDS.map(([source, event]) => [new RegExp(`^(?:${withoutNukta(source)})$`, "u"), event]);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const customWake = (word: string) => new RegExp(`^${escapeRegExp(word.trim()).replace(/\s+/g, "[\\s,]+")}(?=[\\s,!.?]|$)[,!.?]?\\s*`, "i");

/** Drops a leading wake word: Hodey's own (and its common mishearings) or one the learner added. */
function clean(text: string, wakeWords: string[]): string {
  let rest = text.trim().replace(WAKE, "").trim();
  for (const word of wakeWords) rest = rest.replace(customWake(word), "").trim();
  return rest;
}

/** Hands-free: what follows the wake word ("" for the wake word alone), or undefined if the speech wasn't for Hodey. */
export function wakeRest(text: string, wakeWords: string[]): string | undefined {
  const heard = text.trim();
  for (const pattern of [HANDS_FREE_WAKE, ...wakeWords.map(customWake)]) {
    const match = heard.match(pattern);
    if (match) return heard.slice(match[0].length).trim();
  }
  return undefined;
}

function asCommand(text: string): HodeEvent | undefined {
  const bare = withoutNukta(text.toLowerCase().replace(POLITE, " ").replace(POLITE_HINDI, " "))
    .replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...COMMANDS, ...ROMAN_HINGLISH, ...HINDI_PATTERNS].find(([pattern]) => pattern.test(bare))?.[1];
}

const question = (text: string): HodeEvent => ({ type: "VOICE_QUESTION", question: text });

const wordsIn = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);

/** "Thanks", "okay great", "perfect, thank you": acknowledging Hodey, not asking anything. */
export function isAcknowledgement(text: string): boolean {
  const words = wordsIn(text);
  return words.some((w) => ACK_WORDS.has(w)) && words.every((w) => ACK_WORDS.has(w) || ACK_FILLER.has(w));
}

/** Too little to be a question or a goal. */
const tooShort = (text: string) => wordsIn(text).length < MIN_WORDS;

/**
 * What the learner said, as Hode events. Idle: a goal starts a Hode, a what/where question asks about
 * the screen. Goal entry: it's the goal. During a Hode: a control word, or else a question.
 */
export function routeUtterance(s: HodeState, raw: string, packs: TaskPack[], openAllowed: boolean, wakeWords: string[] = []): HodeEvent[] {
  const text = clean(raw, wakeWords);
  if (text.length < MIN_CHARS) return [];
  if (s.phase === "goal_entry") return [goalEvent(text, packs, openAllowed)];
  if (s.phase === "annotating") return [];
  const acknowledged = isAcknowledgement(text);
  if (s.phase !== "idle") {
    if (acknowledged && s.phase === "answering") return [{ type: "DISMISS" }];
    const command = asCommand(text);
    if (command) return [command];
    return acknowledged || tooShort(text) ? [] : [question(text)];
  }
  if (acknowledged || tooShort(text)) return [];
  if (QUESTION_START.test(text)) return [question(text)];
  const goal = goalEvent(text, packs, openAllowed);
  const startable = goal.type === "GOAL_SUBMITTED" && (goal.pack !== undefined || openAllowed);
  return startable ? [{ type: "START_HODE" }, goal] : [question(text)];
}
