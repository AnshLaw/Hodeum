/**
 * What the learner means, from the words alone: rules first, so greetings, filler and speech-recognition
 * noise never start a Hode, and "open Excel" opens Excel instead of becoming a question.
 */
export type Intent = "noise" | "greeting" | "ack" | "control" | "open_app" | "question" | "task" | "unclear";

export interface IntentOptions {
  /** A spoken control ("hint", "pause") in the router's vocabulary. */
  isCommand?: (text: string) => boolean;
  /** Whether a name is an installed app. Without it, any short "open X" counts as an app request. */
  isApp?: (name: string) => boolean;
}

/** Shorter than this (after cleanup) is noise: "um", "uh". */
const MIN_CHARS = 3;
/** "How do I …" needs this many words to be a task ("how are you" is a greeting). */
const MIN_HOW_TO_WORDS = 3;
/** A task verb needs at least this many words around it ("open" alone isn't a task). */
const MIN_TASK_WORDS = 2;
/** An app's name is at most this many words; longer is a task about the app ("open a new tab in Brave"). */
const MAX_APP_NAME_WORDS = 4;

/** Thanks and okays: they close an answer, and with nothing running they need no reply at all. */
const ACK_WORDS = new Set(["ok", "okay", "great", "perfect", "nice", "cool", "awesome", "alright", "understood", "thanks", "thank", "got"]);
const ACK_FILLER = new Set(["you", "it", "so", "much", "a", "lot", "all", "right", "that", "very"]);
const FILLER = new Set(["um", "uh", "uhh", "umm", "hmm", "hm", "mm", "mmm", "ah", "er", "erm", "huh", "oh", "eh", "so", "like", "okay", "ok", "yeah", "yes", "no", "yep", "nope", "right", "well", "and", "the", "a", "हाँ", "हां", "हम्म", "अच्छा"]);
const NUMBER_WORDS = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand"]);
/** What speech recognition writes for silence, music and room noise. */
const HALLUCINATIONS = /^(?:thanks? (?:you )?for watching|thank you\.?|you|bye\.?|subtitles? by.*|\[?(?:music|blank_audio|silence|noise|applause|laughter)\]?|\(.*\))$/i;
/** Leading filler that doesn't change what follows ("um hello", "so hi"). */
const LEADING_FILLER = /^(?:(?:um|uh|so|okay|ok|well|oh) )+/;

/** One greeting, check-in or bit of small talk; an utterance of only these is a greeting. */
const GREETING_PART =
  "(?:hi|hello|hey|hiya|yo|namaste|namaskar|good (?:morning|afternoon|evening|night))(?: there| hodey| hodi| body| everyone| buddy)?" +
  "|how are you(?: doing)?(?: today)?|how(?:'s| is) it going|what'?s up|sup|(?:can|do) you hear me|can you listen(?: to)?(?: me)?" +
  "|are you (?:there|listening|awake|working)|testing(?: one two(?: three)?)?|mic (?:check|test)|is this (?:working|on)" +
  "|who are you|what(?:'s| is) your name|nice to meet you|bye|goodbye|see you|good job|well done" +
  "|नमस्ते|नमस्कार|हेलो|हैलो|हाय|कैसे हो|आप कैसे हैं";
const GREETING = new RegExp(`^(?:${GREETING_PART})(?: (?:${GREETING_PART}))*$`, "u");

/** "Open Excel", "launch the calculator app", "switch to WhatsApp please". */
const OPEN_EN = /^(?:please )?(?:open|launch|start|run|bring up|switch to|go to)(?: up)? (?:the |my )?(.+?)(?: app| application| program| window)?(?: please)?$/;
/** Hinglish ("excel kholo", "whatsapp open karo") and Hindi ("एक्सेल खोलो"). */
const OPEN_HI = /^(?:please )?(.+?) (?:kholo|khol do|kholiye|kholna|open karo|open kar do|chalu karo|start karo|खोलो|खोल दो|खोलिए|खोलिये|ओपन करो|ओपन कर दो|चालू करो)(?: please| na)?$/u;
/** Words that mean more follows the name: a task about the app, not a request to open it. */
const CONNECTORS = /\b(?:and|then|to|in|on|with|for|from|and then)\b/;

/** How-to openers: what follows is something to learn. */
const HOW_TO = /^(?:how (?:do|can|could|would|should|to) (?:i |we |you )?|teach me|show me how|help me|i (?:want|need|would like) to|i'?d like to|let'?s|guide me|walk me through|can you (?:teach|show|help) me)/;
const HOW_TO_HI = /(?:\bkaise\b|कैसे|sikhao|सिखाओ|सिखाइए|बताओ कैसे)/u;
const QUESTION_START = /^(?:what|where|which|why|who|whose|when|is|are|does|did|was|were|can i see|what's|where's)\b/;
const QUESTION_HI = /(?:क्या|कहाँ|कहां|कौन|क्यों|किधर|\bkya\b|\bkahan\b|\bkaun\b|\bkyun\b)/u;
const TASK_VERB =
  /\b(?:make|create|add|insert|build|send|share|attach|open|launch|start|close|change|turn (?:on|off)|switch|enable|disable|set ?up|setup|install|uninstall|zip|unzip|compress|extract|rename|delete|remove|move|copy|paste|find|search|look up|google|download|upload|save|print|format|sort|filter|merge|split|convert|export|import|edit|write|type|draw|record|connect|pair|join|book|order|pay|play|watch|message|call|email|reply|forward|schedule|update|fix|clean|resize|crop|bold|highlight|sum|calculate|chart|graph|pivot|bookmark|pin|mute|unmute)\b/;
const TASK_VERB_HI = /(?:बनाओ|बनाइए|बनाना|भेजो|भेजना|भेजिए|डालो|जोड़ो|जोड़ो|बदलो|हटाओ|ढूंढो|ढूँढो|सेव करो|करना है|\bbanao\b|\bbanana\b|\bbhejo\b|\bbhejna\b|\bdalo\b|\bjodo\b|\bbadlo\b|\bhatao\b|karna hai)/u;

/** Lowercase words, keeping Devanagari vowel signs (marks) inside their words. */
export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const wordsIn = (text: string) => normalize(text).split(" ").filter(Boolean);

/** "Thanks", "okay great", "perfect, thank you": acknowledging Hodey, not asking anything. */
export function isAcknowledgement(text: string): boolean {
  const words = wordsIn(text);
  return words.some((w) => ACK_WORDS.has(w)) && words.every((w) => ACK_WORDS.has(w) || ACK_FILLER.has(w));
}

/** The app named in "open X" (lowercased), or undefined when it isn't a request to open something. */
export function appQuery(raw: string): string | undefined {
  const text = normalize(raw);
  const name = (text.match(OPEN_EN) ?? text.match(OPEN_HI))?.[1]?.trim();
  if (!name || CONNECTORS.test(name)) return undefined;
  return name.split(" ").length <= MAX_APP_NAME_WORDS ? name : undefined;
}

/** Silence, music, filler, counting, or one word said over and over. */
function isNoise(raw: string, text: string, words: string[]): boolean {
  if (text.length < MIN_CHARS) return true;
  if (HALLUCINATIONS.test(raw.trim().toLowerCase()) || HALLUCINATIONS.test(text)) return true;
  if (words.every((w) => FILLER.has(w))) return true;
  if (words.every((w) => NUMBER_WORDS.has(w) || /^\d+$/.test(w))) return true;
  return words.length >= 2 && new Set(words).size === 1;
}

function isGreeting(words: string[]): boolean {
  const deduped = words.filter((w, i) => i === 0 || w !== words[i - 1]).join(" ");
  return GREETING.test(deduped) || GREETING.test(deduped.replace(LEADING_FILLER, ""));
}

function isTask(text: string, words: string[]): boolean {
  if (HOW_TO.test(text) && words.length >= MIN_HOW_TO_WORDS) return true;
  return HOW_TO_HI.test(text) && words.length >= MIN_TASK_WORDS;
}

export function classify(raw: string, options: IntentOptions = {}): Intent {
  const text = normalize(raw);
  const words = text.split(" ").filter(Boolean);
  if (isNoise(raw, text, words)) return "noise";
  if (isGreeting(words)) return "greeting";
  if (isAcknowledgement(text)) return "ack";
  if (options.isCommand?.(text)) return "control";
  const app = appQuery(text);
  if (app !== undefined && (options.isApp?.(app) ?? true)) return "open_app";
  if (isTask(text, words)) return "task";
  if (QUESTION_START.test(text) || QUESTION_HI.test(text)) return "question";
  if ((TASK_VERB.test(text) || TASK_VERB_HI.test(text)) && words.length >= MIN_TASK_WORDS) return "task";
  return "unclear";
}
