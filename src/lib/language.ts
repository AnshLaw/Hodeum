import type { SpeechLanguage } from "../data/settings";
import { isLoanword } from "./hinglish";

/** What Hodey replies in. Hindi is Devanagari throughout; Hinglish is Hindi words in Devanagari with English
 *  words in English letters, the way people type it. */
export const REPLY_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

/** The reply language a setting fixes; undefined for "auto", where Hodey follows what the learner speaks. */
export function replyLanguage(setting: SpeechLanguage): ReplyLanguage | undefined {
  if (setting === "auto") return undefined;
  if (setting === "hi" || setting === "hinglish") return setting;
  return "en";
}

/**
 * The speech model's language prompt for a setting (it has no separate Hinglish mode: "auto" handles mixing).
 * Auto listens in English: the model's open detection, over ~40 languages, heard short English ("volume
 * slider") as Hindi and spelled it in Devanagari. Learners who speak Hindi pick हिन्दी or Hinglish.
 */
export function asrLanguage(setting: SpeechLanguage): "en" | "en-GB" | "hi" | "auto" {
  if (setting === "auto") return "en";
  return setting === "hinglish" ? "auto" : setting;
}

const DEVANAGARI = /[ऀ-ॿ]/;

/** Hindi text, said with a Hindi voice. */
export const hasDevanagari = (text: string): boolean => DEVANAGARI.test(text);

/** Share of English words in Devanagari speech above which it's Hinglish rather than Hindi. */
const HINGLISH_SHARE = 0.2;
/** Fewer words than this never change the reply language: one or two words say too little about it. */
const MIN_SWITCH_WORDS = 3;
/** Hindi grammar words a Devanagari utterance needs before it counts as Hindi, not English spelled in Devanagari. */
const HINDI_GRAMMAR_MIN = 2;
const HINDI_GRAMMAR = new Set(
  "है हैं था थी थे क्या मुझे मुझको मेरा मेरी मेरे में को से का की के नहीं न यह ये वह वो कैसे कैसा कहाँ कहां क्यों और भी तो हो कर करो करें करना करता करती करते कीजिए बनाना बनाओ सिखाओ बताओ बताइए दिखाओ दिखाइए समझ समझाओ चाहिए रहा रही रहे आप हम मैं इसे उसे इस उस पर लिए अब फिर कौन कब कितना".split(" "),
);
/** Hindi words typed (or heard) in English letters; two or more make an utterance Hinglish. */
const ROMAN_HINDI_MIN = 2;
const ROMAN_HINDI = new Set(
  "hai hain kya kaise kaisa kaisi mujhe mera meri mere ye yeh woh wo nahi nahin haan aur ka ki ke ko se mein par pe kar karo karna karte karta karti banana banao batao bataiye dikhao samjhao sikhao chahiye kahan kahaan kyun kyon abhi phir bhi toh ho gaya gayi raha rahe rahi tha thi hoga sakte sakta kijiye bolo dekho ruko bas accha acha theek thik shukriya kaun kab kitna jaldi aage peeche wala wali".split(" "),
);

/** The language the learner just spoke: English, Hindi, or a mix (Hinglish); undefined when too short to tell. */
export function detectLanguage(text: string): ReplyLanguage | undefined {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{M}]/u.test(w));
  if (words.length < MIN_SWITCH_WORDS) return undefined;
  if (hasDevanagari(text)) {
    const grammar = words.filter((w) => HINDI_GRAMMAR.has(w.replace(/[^\p{L}\p{M}]/gu, ""))).length;
    if (grammar < HINDI_GRAMMAR_MIN) return "en";
    const english = words.filter((w) => !hasDevanagari(w) || isLoanword(w.replace(/[^\p{L}\p{M}-]/gu, ""))).length;
    return english / words.length >= HINGLISH_SHARE ? "hinglish" : "hi";
  }
  const romanHindi = words.filter((w) => ROMAN_HINDI.has(w.toLowerCase().replace(/[^a-z]/g, ""))).length;
  return romanHindi >= ROMAN_HINDI_MIN ? "hinglish" : "en";
}
