import type { TaskPack } from "../lib/types";

/** Matched by a one-word phrase only ("zip"), a pack must own at least this share of the goal's words (beyond filler and app names). */
const MIN_COVERAGE = 0.4;
/** A phrase of this many words, all in the goal ("pivot table"), names the task on its own. */
const STRONG_PHRASE_WORDS = 2;
/** Shorter English words keep a final "s" ("bus", "ms"); longer ones lose a plural one. */
const MIN_PLURAL_LENGTH = 4;

/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently, so it's ignored. */
const NUKTA = /़/g;

/** Words that carry no task (requests, filler, pronouns) in English, Roman Hinglish and Hindi. */
const FILLER = new Set([
  ..."a an the in on of to for into from with by at my me i you your how do does can could would please teach show help learn want need make create these this that those some it its is are be using use way what so just let lets now then about and or all get new".split(" "),
  ..."mujhe muje mujhko ye yeh ko ka ki ke kaise banana banao banaye banaiye sikhao sikha sikhaiye karo karna kar karte mein hai ho kya aur ek mera meri mere".split(" "),
  ..."मुझे मुझको ये यह को का की के कैसे बनाना बनाओ बनाइए सिखाओ सिखाइए करो करना कीजिए में है हैं और एक मेरे मेरी मेरा इन इस".split(" "),
]);


function tokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(NUKTA, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** One form per word: "files" → "file", "फाइलें" → "फाइल". */
function stem(word: string): string {
  if (/^[a-z]+$/.test(word)) return word.length >= MIN_PLURAL_LENGTH && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return word.replace(/(?:ें|ों)$/u, "");
}

/** App and device names: they say where a task happens, so they never count against a pack. Stemmed like goal words. */
const APP_WORDS = new Set("excel spreadsheet explorer windows iphone phone powerpoint word outlook notepad chrome edge laptop pc computer app microsoft एक्सेल एक्सप्लोरर आईफोन फोन विंडोज".split(" ").map((word) => stem(word)));

/** The words of a goal or phrase that say what the task is (numbers, like a phone's model, say nothing). */
const taskWords = (text: string): string[] => tokens(text).filter((word) => !FILLER.has(word) && !/^\d+$/.test(word)).map(stem);

interface Fit {
  pack: TaskPack;
  coverage: number;
  /** Words in the longest goal phrase the goal contains in full. */
  phrase: number;
}

/**
 * How well a pack fits a goal: it must contain one of the pack's phrases in full, own at least half of
 * the goal's other words, not be about another app the goal names, and not be a task the pack rules out.
 */
function fit(words: string[], app: string | undefined, pack: TaskPack): Fit | undefined {
  if (app !== undefined && app !== pack.app) return undefined;
  if (pack.notFor?.some((word) => words.includes(stem(word.toLowerCase())))) return undefined;
  const phrases = pack.goalPhrases.map(taskWords).filter((phrase) => phrase.length > 0);
  const contained = phrases.filter((phrase) => phrase.every((word) => words.includes(word)));
  if (contained.length === 0) return undefined;
  const vocabulary = new Set(phrases.flat());
  const counted = words.filter((word) => vocabulary.has(word) || !APP_WORDS.has(word));
  const coverage = counted.filter((word) => vocabulary.has(word)).length / counted.length;
  const phrase = Math.max(...contained.map((p) => p.length));
  return phrase >= STRONG_PHRASE_WORDS || coverage >= MIN_COVERAGE ? { pack, coverage, phrase } : undefined;
}

/** The pack a goal asks for, or undefined: a goal that only shares a word or two with a pack isn't its lesson. */
export function matchGoal(goal: string, packs: TaskPack[]): TaskPack | undefined {
  const words = [...new Set(taskWords(goal))];
  const app = appFromGoal(goal);
  const fits = packs.map((pack) => fit(words, app, pack)).filter((f): f is Fit => f !== undefined);
  return fits.sort((a, b) => b.coverage - a.coverage || b.phrase - a.phrase)[0]?.pack;
}

/**
 * Apps a goal can name, as Rust's `app_name` reports them. Everyday words ("word", "edge") only count
 * when capitalised or after a cue like "in", so "pick the right word" doesn't open Microsoft Word.
 */
const APP_PATTERNS: [string, RegExp][] = [
  ["Excel", /\bexcel\b|\bspreadsheet|एक्सेल/i],
  ["PowerPoint", /\bpower ?point\b|पावर ?पॉइंट/i],
  ["Word", /\b(?:microsoft |ms )?Word\b|\b(?:in|using|open|with) word\b/],
  ["File Explorer", /\b(?:file )?explorer\b|एक्सप्लोरर/i],
  ["Chrome", /\bchrome\b/i],
  ["Edge", /\bmicrosoft edge\b|\b(?:in|using|open) edge\b/i],
  ["Outlook", /\boutlook\b/i],
  ["Notepad", /\bnotepad\b/i],
];

/** The app an open-ended goal is about, so Hodey brings it forward and stays in it. */
export function appFromGoal(goal: string): string | undefined {
  return APP_PATTERNS.find(([, pattern]) => pattern.test(goal))?.[0];
}
