import type { SpeechLanguage } from "../data/settings";

/** What Hodey replies in. Hindi and Hinglish share Hodey's fixed lines (natural spoken Hindi with
 *  English computer words written in Devanagari); the vision model mixes in more English for Hinglish. */
export const REPLY_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

/** The learner's language setting decides both what Hodey listens for and what it answers in. */
export function replyLanguage(speech: SpeechLanguage): ReplyLanguage {
  if (speech === "hi") return "hi";
  if (speech === "auto") return "hinglish";
  return "en";
}

const DEVANAGARI = /[\u0900-\u097F]/;

/** Hindi text, said with a Hindi voice. */
export const hasDevanagari = (text: string): boolean => DEVANAGARI.test(text);
