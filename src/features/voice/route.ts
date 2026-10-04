import type { InstalledApp, TaskPack } from "../../lib/types";
import { goalEvent, goalEvents } from "../hode/bridge";
import type { HodeEvent, HodeState } from "../hode/model";
import { appChoiceEvent, idleOpenAppEvent, openAppEvent } from "../hode/open-app";
import { classify, isAcknowledgement, isSubstantive, opensWithQuestion, type Intent } from "./intent";

export { isAcknowledgement } from "./intent";

/** Hodey's name as speech recognition writes it: "body", "howdy", "hodie", and (measured) "holdy", "hudi", "hodee". */
const NAME = String.raw`(?:hode?y|hod(?:ee|[iy]e?)|hoadie|howdy|body|hold[iy]e?|hu?d[iy])`;
/** Said before a command or question; dropped before matching. The greeting may run into the name ("heyhodi"). */
const WAKE = new RegExp(String.raw`^(?:(?:hey|hi|hello|ok|okay)[ ,]*)?${NAME}\b[,!.]?\s*`, "i");
const POLITE = /\b(?:please|thanks|thank you|can you|could you)\b/gi;
/** Utterances shorter than this (after cleanup) are noise: "um", "uh". */
const MIN_CHARS = 3;
/** A question or goal has at least this many words; a lone word that isn't a control is noise (keyboard clicks). */
const MIN_WORDS = 2;

/** Spoken controls during a Hode. Matched against the whole cleaned utterance, so questions aren't misread. */
const COMMANDS: [RegExp, HodeEvent][] = [
  [/^(?:(?:give me )?a hint|hint|help(?: me)?|i'?m stuck|i am stuck)$/, { type: "HINT_REQUESTED" }],
  [/^(?:explain(?: that| this)?|why)$/, { type: "EXPLAIN_REQUESTED" }],
  // "Where?" / "I don't see it" (PRD §7): more help, unlike "wait", which pauses.
  [/^(?:where|where is it|where's it|where is that|i (?:don'?t|do not|can'?t|cannot) (?:see|find) (?:it|that)(?: anywhere)?)$/, { type: "SAID_STUCK" }],
  [/^(?:repeat(?: that)?|say (?:that|it) again|again|what did you say)$/, { type: "REPEAT" }],
  [/^(?:look again|check again|i did it|done|i'?m done|finished)$/, { type: "LOOK_AGAIN" }],
  [/^(?:let me try|i'?ll try|i will try|stop helping(?: me)?|i'?ve got (?:this|it)|i got this)$/, { type: "LET_ME_TRY" }],
  [/^(?:(?:just )?show me(?: how)?|show me how to do it|demonstrate(?: it)?)$/, { type: "SHOW_ME" }],
  [/^(?:skip(?: (?:it|this|that|this step|the step|step))?|next step|move on)$/, { type: "SKIP_STEP" }],
  // Also the card's own button label read aloud ("Practice on your own").
  [/^(?:practi[cs]e(?: (?:again|it|alone|on (?:my|your) own))?|let me practi[cs]e(?: (?:again|it|alone|on (?:my|your) own))?|again on (?:my|your) own)$/, { type: "PRACTICE_AGAIN" }],
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
const HANDS_FREE_WAKE = new RegExp(String.raw`^(?:(?:hey|hi|hello|ok|okay)[ ,]*${NAME}|hode?y|hod(?:ee|[iy]e?)|hoadie|(?:(?:हे|हाय|ओके)[ ,]*)?होडी)(?=[\s,!.?]|$)[,!.?]?\s*`, "i");

/** The same controls in Hindi and Hinglish, as Hindi speech recognition writes them (in Devanagari). */
const HINDI_COMMANDS: [string, HodeEvent][] = [
  ["हिंट(?: दो| दीजिए| चाहिए)?|संकेत(?: दो| दीजिए)?|मदद(?: करो| कीजिए| चाहिए)?|हेल्प(?: करो)?|मैं (?:फंस|फँस|अटक) (?:गया|गई)", { type: "HINT_REQUESTED" }],
  ["समझाओ|समझाइए|समझाइये|क्यों|एक्सप्लेन करो", { type: "EXPLAIN_REQUESTED" }],
  ["(?:(?:ये|यह|वो|वह) )?(?:कहाँ|कहां|किधर) (?:है|हैं)(?: (?:ये|यह|वो|वह))?|(?:मुझे )?(?:नहीं (?:दिख|मिल) (?:रहा|रही)|(?:दिख|मिल) नहीं (?:रहा|रही))(?: है)?", { type: "SAID_STUCK" }],
  ["(?:फिर से|दोबारा)(?: बोलो| बोलिए| कहो| कहिए)?|रिपीट(?: करो)?|क्या (?:बोला|कहा)", { type: "REPEAT" }],
  ["हो गया|कर दिया|कर लिया|डन|(?:फिर से|दोबारा) देखो", { type: "LOOK_AGAIN" }],
  ["मुझे (?:करने|ट्राई करने) दो|मैं (?:खुद )?(?:करता|करती) ह(?:ूं|ूँ)", { type: "LET_ME_TRY" }],
  ["(?:करके )?(?:दिखाओ|दिखाइए|दिखाइये)|कर के दिखाओ", { type: "SHOW_ME" }],
  ["(?:ये |यह )?(?:स्टेप )?(?:छोड़ो|छोड़ दो|स्किप करो)|अगला स्टेप", { type: "SKIP_STEP" }],
  ["(?:खुद )?प्रैक्टिस करो|फिर से करो", { type: "PRACTICE_AGAIN" }],
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
  [/^(?:(?:karke |kar ke )?dikhao|dikhaiye|show karo)$/, { type: "SHOW_ME" }],
  [/^(?:(?:ye |yeh )?(?:step )?(?:skip karo|chhod do|chhodo)|agla step)$/, { type: "SKIP_STEP" }],
  [/^(?:(?:khud )?practice karo|phir se karo|khud kar ?ke dekhta hoon|khud kar ?ke dekhti hoon)$/, { type: "PRACTICE_AGAIN" }],
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

/** Words that only make a request polite, before it. */
const LOOK_UP_POLITE = /^(?:(?:can|could|would|will) you |please |just )+/;
/**
 * The learner asks Hodey to take a question to the web. Group 1, when there is one, is the question itself;
 * otherwise it's the question just asked. "Search for a file" stays a task in the app: only the web,
 * online, the internet or Google make it a look-up.
 */
const LOOK_UP_PATTERNS: RegExp[] = [
  /^(?:look|check) (?:it|that|this) up(?: online| on the web| on the internet| on google)?(?: for me)?$/,
  /^look up ((?:how|what|where|why|when|which|who)\b.+)$/,
  /^(?:search|check|look) (?:the web|on the web|online|the internet|on the internet|on google|google)(?: (?:for|about) (.+))?$/,
  /^google (?:it|that|this)(?: for me)?$/,
  /^google (?:for )?((?:how|what|where|why|when|which|who)\b.+)$/,
  /^(?:(?:isko|ise|ye|yeh|isse) )?(?:google|search|online|internet pe|internet par) (?:karo|kar do|kijiye|dekho|check karo)$/,
  /^(.+?) (?:google|search) (?:karo|kar do|kijiye)$/,
  /^(?:(?:इसे|ये|यह) )?(?:गूगल|सर्च|ऑनलाइन|इंटरनेट पर) (?:करो|कर दो|कीजिए|देखो)$/,
  /^(.+?) (?:गूगल|सर्च) (?:करो|कर दो|कीजिए)$/,
];

const lookUpText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LOOK_UP_POLITE, "")
    .replace(/ please$/, "");

/** The question just asked: the one being answered, else the learner's last words in the conversation. */
function lastQuestion(s: HodeState): string | undefined {
  return s.spokenQuestion ?? [...(s.dialogue ?? [])].reverse().find((turn) => turn.who === "learner")?.text;
}

/** "Look it up", "search the web for …", "google karo": a question Hodey may take to the web. */
function lookUpRequest(s: HodeState, text: string): HodeEvent | undefined {
  const bare = lookUpText(text);
  for (const pattern of LOOK_UP_PATTERNS) {
    const match = bare.match(pattern);
    if (!match) continue;
    const asked = match[1]?.trim() || lastQuestion(s);
    return asked ? { type: "VOICE_QUESTION", question: asked, lookUp: true } : undefined;
  }
  return undefined;
}

const wordsIn = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);

/** Too little to be a question or a goal. */
const tooShort = (text: string) => wordsIn(text).length < MIN_WORDS;

const isCommand = (text: string) => asCommand(text) !== undefined;

/** During a Hode: a control, an app to open, or else a question ("is this on?" too). Noise and greetings are dropped. */
function routeInHode(s: HodeState, text: string, apps: InstalledApp[]): HodeEvent[] {
  const acknowledged = isAcknowledgement(text);
  if (acknowledged && s.phase === "answering") return [{ type: "DISMISS" }];
  const command = asCommand(text);
  if (command) return [command];
  if (acknowledged || tooShort(text)) return [];
  const intent = classify(text, { isCommand, inHode: true });
  if (intent === "noise" || intent === "greeting") return [];
  // "Open the insert tab" names no installed app, so it stays a question about the screen.
  const open = intent === "open_app" ? openAppEvent(text, apps) : undefined;
  return [open ?? question(text)];
}

/** "How do I…", "teach me…", "help me…": a request to be taught, planned into a Hode rather than answered once. */
const TEACH_ME =
  /^(?:how (?:do|can|would|should|could) (?:i|we|you)|how to|where do i|teach me|show me how|help me|i want to|i need to|i'd like to|(?:can|could|will|would) you (?:teach|show|help))|(?:kaise|sikhao|sikha do)|कैसे|सिखाओ|सिखा दो/i;

/**
 * Idle, once it's neither small talk nor noise: a pack's lesson, a task or a request to be taught (planned into a
 * Hode, which says so while vision loads), or a question about the screen. A pack's words start its lesson even
 * around a Hindi question word ("क्या आप मुझे डार्क मोड चालू करना सिखा सकते हैं"); one that opens with a question
 * word ("what is a pivot table?") is answered instead. Anything else with a few real words in it ("explain this
 * screen") is asked about the screen.
 */
function askOrStart(text: string, intent: Intent, packs: TaskPack[], openAllowed: boolean, visionStarting: boolean, apps: InstalledApp[]): HodeEvent[] {
  const goal = goalEvent(text, { packs, openAllowed, apps, visionStarting });
  if (goal.type === "GOAL_SUBMITTED" && goal.pack && !opensWithQuestion(text)) return [{ type: "START_HODE" }, goal];
  if (intent === "task" || TEACH_ME.test(text)) return [{ type: "START_HODE" }, goal];
  return intent === "question" || isSubstantive(text) ? [question(text)] : [];
}

/**
 * Idle: a task, a pack's own words or a how-to request starts a Hode; a greeting or mic check gets a reply, noise and
 * fragments nothing. A reply to "Did you mean Outlook or Outlook (classic)?" that picks one opens it.
 */
function routeIdle(s: HodeState, text: string, packs: TaskPack[], openAllowed: boolean, apps: InstalledApp[], visionStarting: boolean): HodeEvent[] {
  const open = appChoiceEvent(s, text, apps) ?? idleOpenAppEvent(text, apps, openAllowed);
  if (open) return [open];
  // App requests are settled above: one that names no app is judged by its words ("open a new tab").
  const intent = classify(text, { isCommand, isApp: () => false });
  if (intent === "greeting") return [{ type: "CHITCHAT", kind: "greeting" }];
  if (intent === "noise" || intent === "ack" || intent === "control" || tooShort(text)) return [];
  return askOrStart(text, intent, packs, openAllowed, visionStarting, apps);
}

/**
 * What the learner said, as Hode events. Idle: a task starts a Hode, a what/where question asks about the
 * screen, a greeting gets a reply, "open Excel" opens it. Goal entry: it's the goal. During a Hode: a control
 * word, an app to open, or else a question. `apps`: the installed apps, for "open X" (none: no app requests).
 */
export function routeUtterance(s: HodeState, raw: string, packs: TaskPack[], openAllowed: boolean, wakeWords: string[] = [], apps: InstalledApp[] = [], visionStarting = false): HodeEvent[] {
  const text = clean(raw, wakeWords);
  if (text.length < MIN_CHARS) return [];
  if (s.phase === "annotating") return [];
  if (s.phase === "goal_entry") return classify(text) === "noise" ? [] : goalEvents(text, { packs, openAllowed, apps });
  // The closing question is open: anything said is an answer to it, even one word ("Insert").
  const answering = s.phase === "success" && s.review !== undefined && s.review.picked === undefined;
  if (answering && !isAcknowledgement(text)) return [asCommand(text) ?? { type: "REVIEW_ANSWERED", said: text }];
  const lookUp = lookUpRequest(s, text);
  if (lookUp) return [lookUp];
  return s.phase === "idle" ? routeIdle(s, text, packs, openAllowed, apps, visionStarting) : routeInHode(s, text, apps);
}
