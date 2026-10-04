import type { InstalledApp } from "../../lib/types";
import { COMMON_WORDS } from "./common-words";

/** A spoken app name against the Start menu's apps: one app, a few equally good ones, or none. */
export type AppMatch = { kind: "match"; app: InstalledApp } | { kind: "ambiguous"; options: InstalledApp[] } | { kind: "none" };

const EXACT = 1;
/** The query is the first words of the name ("snipping" for Snipping Tool). */
const PREFIX = 0.9;
/** Every query word is in the name, minus a little for each extra word ("settings" prefers Settings to WSL Settings). */
const ALL_WORDS = 0.8;
const PER_EXTRA_WORD = 0.05;
/** A near spelling (speech recognition's "calculater") counts at its similarity, less this. */
const TYPO_PENALTY = 0.1;
const MIN_TYPO_SIMILARITY = 0.9;
/** Typos only between names of about the same length, so "photoshop" never becomes Photos. */
const MAX_TYPO_LENGTH_GAP = 2;
const MIN_SCORE = 0.8;
/** The best app must beat the next by this much, or Hodey asks which one. */
const MIN_MARGIN = 0.1;
const SCORE_EPSILON = 1e-9;
const MAX_OPTIONS = 3;
const JARO_WINKLER_PREFIX = 4;
const JARO_WINKLER_SCALE = 0.1;

interface KnownApp {
  id: string;
  /** What its windows report as their app (`KNOWN` in src-tauri/src/apps/identity.rs). */
  name: string;
  /** Matches the catalog entry's id (its AUMID or shortcut path). */
  catalogId: RegExp;
  aliases: string[];
}

/** The apps learners ask for most, with what they call them (Hindi spellings too). */
const KNOWN: KnownApp[] = [
  { id: "excel", name: "Excel", catalogId: /^Microsoft\.Office\.EXCEL\.EXE/i, aliases: ["excel", "spreadsheet", "एक्सेल"] },
  { id: "word", name: "Word", catalogId: /^Microsoft\.Office\.WINWORD\.EXE/i, aliases: ["word", "ms word", "वर्ड"] },
  { id: "powerpoint", name: "PowerPoint", catalogId: /^Microsoft\.Office\.POWERPNT\.EXE/i, aliases: ["powerpoint", "power point", "ppt", "पावरपॉइंट", "पावर पॉइंट"] },
  { id: "file-explorer", name: "File Explorer", catalogId: /^Microsoft\.Windows\.Explorer$/i, aliases: ["file explorer", "explorer", "files", "my files", "this pc", "my computer", "फ़ाइल एक्सप्लोरर", "फाइल एक्सप्लोरर"] },
  { id: "settings", name: "Settings", catalogId: /^windows\.immersivecontrolpanel_/i, aliases: ["settings", "windows settings", "setting", "सेटिंग्स", "सेटिंग"] },
  { id: "calculator", name: "Calculator", catalogId: /^Microsoft\.WindowsCalculator_/i, aliases: ["calculator", "calc", "कैलकुलेटर"] },
  { id: "notepad", name: "Notepad", catalogId: /^Microsoft\.WindowsNotepad_|notepad\.exe$/i, aliases: ["notepad", "note pad", "नोटपैड"] },
  { id: "paint", name: "Paint", catalogId: /^Microsoft\.Paint_|mspaint\.exe$/i, aliases: ["paint", "ms paint", "पेंट"] },
  { id: "whatsapp", name: "WhatsApp", catalogId: /WhatsAppDesktop/i, aliases: ["whatsapp", "whats app", "watsapp", "whatsapp desktop", "व्हाट्सएप", "व्हाट्सऐप", "वॉट्सऐप", "वॉट्सएप"] },
  { id: "brave", name: "Brave", catalogId: /^Brave$/i, aliases: ["brave", "ब्रेव"] },
  { id: "chrome", name: "Chrome", catalogId: /^Chrome$/i, aliases: ["chrome", "क्रोम"] },
  { id: "edge", name: "Edge", catalogId: /^MSEdge$/i, aliases: ["edge", "ms edge", "एज"] },
  { id: "vs-code", name: "VS Code", catalogId: /VisualStudioCode/i, aliases: ["vs code", "vscode", "visual studio code", "code"] },
];

const LEADING = /^(?:the |my |microsoft |ms |google )+/;
const TRAILING = /(?: app| application| program| browser| classic)+$/;
/** `TRAILING` without a variant's qualifier: "Outlook (classic)" keeps its "classic" here. */
const GENERIC = /(?: app| application| program| browser)+$/;
/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently. */
const NUKTA = /़/g;

/** Lowercase words, without punctuation ("Outlook (classic)" → "outlook classic"). */
function plainWords(text: string): string {
  return text
    .normalize("NFC")
    .replace(NUKTA, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase words without "Microsoft", "the", "app" and the like, on both the query and the names. */
export function normalizeName(text: string): string {
  return plainWords(text).replace(LEADING, "").replace(TRAILING, "").trim();
}

/** `normalizeName`, keeping the qualifier that tells an app's variants apart. */
function variantName(text: string): string {
  return plainWords(text).replace(LEADING, "").replace(GENERIC, "").trim();
}

const wordsOf = (name: string) => name.split(" ").filter((word) => word !== "");

/** The same words, in any order ("classic outlook", "Outlook (classic)"). */
const sameWords = (a: string[], b: string[]) => [...a].sort().join(" ") === [...b].sort().join(" ");

const ALIASES = new Map(KNOWN.flatMap((known) => known.aliases.map((alias) => [normalizeName(alias), known] as const)));

/** The stable app id for a friendly name ("File Explorer" → "file-explorer"), else the name lowercased. */
export function knownAppId(name: string): string {
  const normal = normalizeName(name);
  return ALIASES.get(normal)?.id ?? normal;
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const used = new Array<boolean>(b.length).fill(false);
  const matchedA: string[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (used[j] || a[i] !== b[j]) continue;
      used[j] = true;
      matchedA.push(a[i]);
      break;
    }
  }
  if (matchedA.length === 0) return 0;
  const matchedB = [...b].filter((_, j) => used[j]);
  const transpositions = matchedA.filter((c, k) => c !== matchedB[k]).length / 2;
  const m = matchedA.length;
  return (m / a.length + m / b.length + (m - transpositions) / m) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const similarity = jaro(a, b);
  let prefix = 0;
  while (prefix < Math.min(JARO_WINKLER_PREFIX, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return similarity + prefix * JARO_WINKLER_SCALE * (1 - similarity);
}

function typoScore(query: string, name: string): number {
  if (Math.abs(query.length - name.length) > MAX_TYPO_LENGTH_GAP) return 0;
  const similarity = jaroWinkler(query, name);
  return similarity >= MIN_TYPO_SIMILARITY ? similarity - TYPO_PENALTY : 0;
}

/** How well a normalised query names a normalised app name, 0 to 1. */
function nameScore(query: string, name: string): number {
  if (query === name) return EXACT;
  const queryWords = query.split(" ");
  const nameWords = name.split(" ");
  if (queryWords.every((word, i) => nameWords[i] === word)) return PREFIX;
  if (queryWords.every((word) => nameWords.includes(word))) return ALL_WORDS - PER_EXTRA_WORD * (nameWords.length - queryWords.length);
  return typoScore(query, name);
}

/** The query as one of the known apps' aliases (or a near spelling of one). */
function knownFor(query: string): KnownApp | undefined {
  const exact = ALIASES.get(query);
  if (exact) return exact;
  return [...ALIASES.entries()].find(([alias]) => typoScore(query, alias) >= MIN_SCORE)?.[1];
}

function scoreApp(query: string, app: InstalledApp, known: KnownApp | undefined): number {
  if (known?.catalogId.test(app.id)) return EXACT;
  return nameScore(query, normalizeName(app.name));
}

/**
 * The app whose whole name the query is, variant qualifier and all ("Outlook classic"), when no other app's name
 * holds every word of it: "outlook" alone also fits "Outlook (classic)", so it is left to the scoring (and a question).
 */
function variantMatch(query: string, catalog: InstalledApp[]): InstalledApp | undefined {
  const words = wordsOf(variantName(query));
  const names = catalog.map((app) => wordsOf(variantName(app.name)));
  const named = catalog.filter((_, i) => sameWords(names[i], words));
  if (named.length !== 1) return undefined;
  const alsoFits = catalog.some((app, i) => app !== named[0] && words.every((word) => names[i].includes(word)));
  return alsoFits ? undefined : named[0];
}

export function resolveApp(query: string, catalog: InstalledApp[]): AppMatch {
  const normal = normalizeName(query);
  if (normal === "") return { kind: "none" };
  const variant = variantMatch(query, catalog);
  if (variant) return { kind: "match", app: variant };
  const known = knownFor(normal);
  const scored = catalog
    .map((app) => ({ app, score: scoreApp(normal, app, known) }))
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: "none" };
  const [best, next] = scored;
  if (!next || best.score - next.score >= MIN_MARGIN - SCORE_EPSILON) return { kind: "match", app: best.app };
  const close = scored.filter(({ score }) => best.score - score < MIN_MARGIN - SCORE_EPSILON);
  return { kind: "ambiguous", options: close.slice(0, MAX_OPTIONS).map(({ app }) => app) };
}

/** Stands for the last option offered, however many there were. */
const LAST = -1;
/** Picking an offered app by its place, in English, Hinglish and Hindi (written without the nukta). */
const PLACES = new Map<string, number>(
  (
    [
      [0, "first 1st 1 pehla pehle pehli pahla pahle pahli पहला पहले पहली"],
      [1, "second 2nd 2 two doosra doosre doosri dusra dusre dusri दूसरा दूसरे दूसरी"],
      [2, "third 3rd 3 three teesra teesre teesri tisra tisre tisri तीसरा तीसरे तीसरी"],
      [LAST, "last aakhri akhri aakhiri आखिरी"],
    ] as const
  ).flatMap(([place, words]) => words.split(" ").map((word) => [word, place] as const)),
);
/** "Number one": "one" alone is too common a word to be a place. */
const NUMBER_ONE = /\b(?:number|option) one\b/g;
/** Words around a pick that don't say which: "the classic one", "doosra wala", "open the first please". */
const PICK_FILLER = new Set(
  "the one option number no yes yeah ok okay i mean meant want that this it is open launch start please wala wali wale vala vali vale haan han ji wo woh ye yeh वाला वाली वाले हाँ हां जी वो वह ये यह".split(" "),
);

function placeOf(word: string, count: number): number | undefined {
  const place = PLACES.get(word);
  if (place === undefined) return undefined;
  const index = place === LAST ? count - 1 : place;
  return index < count ? index : undefined;
}

/** The one option the words name in full, else the one option holding every word ("classic"). */
function namedOption(words: string[], options: string[]): number | undefined {
  const names = options.map((option) => wordsOf(variantName(option)));
  const exact = names.flatMap((name, i) => (sameWords(name, words) ? [i] : []));
  if (exact.length === 1) return exact[0];
  const holding = names.flatMap((name, i) => (words.every((word) => name.includes(word)) ? [i] : []));
  return holding.length === 1 ? holding[0] : undefined;
}

/**
 * Which of the offered apps a reply picks, as its index: by place ("the second one", "doosra wala", "दूसरा")
 * or by name ("Outlook classic", "classic wala"). Undefined when it picks none of them.
 */
export function pickOption(reply: string, options: string[]): number | undefined {
  const words = wordsOf(variantName(reply).replace(NUMBER_ONE, "first")).filter((word) => !PICK_FILLER.has(word));
  if (words.length === 0) return undefined;
  const place = words.length === 1 ? placeOf(words[0], options.length) : undefined;
  return place ?? namedOption(words, options);
}

/** Hodeum lists itself in the Start menu; a goal about Hodeum is never about an app to go and open. */
const OWN_NAME = "hodeum";
/** Shorter names ("X") are too easily a letter or a word in a goal. */
const MIN_NAME_CHARS = 3;
/** A name of up to this many everyday words ("Photos", "Phone Link") must be used like an app; longer ones are names. */
const MAX_EVERYDAY_NAME_WORDS = 2;
/** Said right before an app's name: "in Paint", "on Discord", "using Notepad", "open Photos". */
const BEFORE_APP = new Set("in on using use with open launch start run from into inside".split(" "));
/** May come between that word and the name: "in the Photos app", "on my Phone Link". */
const DETERMINERS = new Set("the my your this".split(" "));
/** Said right after an app's name: "the Photos app", and Hinglish and Hindi postpositions ("Paint mein", "Discord pe"). */
const AFTER_APP = new Set("app application program browser window mein me pe par se में पर पे से".split(" "));
/** "(64bit)", "(classic)", "(work or school)": not what people call the app. */
const QUALIFIER = /\s*\([^)]*\)/g;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const CAPITALISED = /^\p{Lu}/u;
/** A name needs a letter: "365" of "Microsoft 365" is a number in a goal. */
const LETTER = /\p{L}/u;

/** One way to name an app, as words. */
interface Phrase {
  words: string[];
  /** Its whole Start-menu name, not a shortening ("ChatGPT", not "ChatGPT Classic" without "Classic"). */
  whole: boolean;
}

/** Where a goal names an app, in words. */
interface Mention {
  /** What the app's windows report as their app. */
  app: string;
  start: number;
  /** One past the last word. */
  end: number;
  whole: boolean;
}

/** A text's words, case kept, so a capitalised name ("Paint") can say it's the app. */
function textWords(text: string): string[] {
  return text.normalize("NFC").replace(NUKTA, "").match(WORD) ?? [];
}

const knownEntry = (app: InstalledApp) => KNOWN.find((known) => known.catalogId.test(app.id));

/**
 * What the app's windows report as their app (apps/identity.rs): a known app's own name ("VS Code"), a packaged
 * app's Start-menu name, and a desktop app's without "(64bit)" and the like, since its windows go by its program's
 * description.
 */
function windowName(app: InstalledApp): string {
  const known = knownEntry(app);
  if (known) return known.name;
  return app.kind === "packaged" ? app.name : app.name.replace(QUALIFIER, "").trim();
}

/** How a goal can name the app: its whole name, the name without "Microsoft" and the like, and a known app's aliases. */
function phrasesOf(app: InstalledApp): Phrase[] {
  const name = app.name.replace(QUALIFIER, " ");
  const whole = textWords(name.toLowerCase());
  const shortened = [normalizeName(name), ...(knownEntry(app)?.aliases ?? []).map(normalizeName)].map(textWords);
  const phrases = new Map<string, Phrase>();
  for (const words of [whole, ...shortened]) {
    const text = words.join(" ");
    if (!phrases.has(text) && text.length >= MIN_NAME_CHARS && LETTER.test(text)) phrases.set(text, { words, whole: words === whole });
  }
  return [...phrases.values()];
}

/** Only everyday words: then the goal has to use it like an app. */
function isEveryday(phrase: string[]): boolean {
  return phrase.length <= MAX_EVERYDAY_NAME_WORDS && phrase.every((word) => COMMON_WORDS.has(word));
}

/** Capitalised where a plain word wouldn't be: not the first word, and not in text written all in capitals. */
function capitalisedMidSentence(words: string[], start: number, end: number): boolean {
  const shouting = words.every((word) => word === word.toUpperCase());
  return start > 0 && !shouting && words.slice(start, end).every((word) => CAPITALISED.test(word));
}

/** "in Paint", "in the Photos app", "Paint mein", or "Paint" capitalised mid-sentence. */
function usedAsApp(words: string[], lower: string[], start: number, end: number): boolean {
  const before = lower[start - 1] ?? "";
  const cued = BEFORE_APP.has(before) || (DETERMINERS.has(before) && BEFORE_APP.has(lower[start - 2] ?? ""));
  return cued || AFTER_APP.has(lower[end] ?? "") || capitalisedMidSentence(words, start, end);
}

/** Where `phrase` occurs in `lower` as whole words. */
function startsOf(lower: string[], phrase: string[]): number[] {
  const starts: number[] = [];
  for (let start = 0; start + phrase.length <= lower.length; start++) {
    if (phrase.every((word, offset) => lower[start + offset] === word)) starts.push(start);
  }
  return starts;
}

function mentionsOf(app: InstalledApp, words: string[], lower: string[]): Mention[] {
  const name = windowName(app);
  return phrasesOf(app).flatMap(({ words: phrase, whole }) =>
    startsOf(lower, phrase)
      .filter((start) => !isEveryday(phrase) || usedAsApp(words, lower, start, start + phrase.length))
      .map((start) => ({ app: name, start, end: start + phrase.length, whole })),
  );
}

/** Inside a longer mention: "WhatsApp" in "WhatsApp Web", "Photos" in "Amazon Photos". */
const within = (inner: Mention, outer: Mention) => outer.start <= inner.start && inner.end <= outer.end && outer.end - outer.start > inner.end - inner.start;
const sameSpan = (a: Mention, b: Mention) => a.start === b.start && a.end === b.end;

/** The mentions that say which app: none inside a longer one, and a whole name over a shortening of the same words. */
function deciding(mentions: Mention[]): Mention[] {
  const outer = mentions.filter((mention) => !mentions.some((other) => within(mention, other)));
  return outer.filter((mention) => mention.whole || !outer.some((other) => other.whole && sameSpan(other, mention)));
}

/**
 * The installed app a goal names ("send a message on Discord" → "Discord"), as its windows report it, or
 * undefined when it names none or several. The whole name must be there as words; a name of everyday words
 * ("Photos", "Phone Link") counts only when used like an app: "in Photos", "open Photos", "the Photos app",
 * "Photos mein", or capitalised mid-sentence.
 */
export function appNamedIn(goal: string, catalog: InstalledApp[]): string | undefined {
  const words = textWords(goal);
  const lower = words.map((word) => word.toLowerCase());
  const mentions = catalog.filter((app) => normalizeName(app.name) !== OWN_NAME).flatMap((app) => mentionsOf(app, words, lower));
  const names = new Set(deciding(mentions).map((mention) => mention.app));
  return names.size === 1 ? [...names][0] : undefined;
}

