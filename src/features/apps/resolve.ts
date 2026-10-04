import type { InstalledApp } from "../../lib/types";

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
  /** Matches the catalog entry's id (its AUMID or shortcut path). */
  catalogId: RegExp;
  aliases: string[];
}

/** The apps learners ask for most, with what they call them (Hindi spellings too). */
const KNOWN: KnownApp[] = [
  { id: "excel", catalogId: /^Microsoft\.Office\.EXCEL\.EXE/i, aliases: ["excel", "spreadsheet", "एक्सेल"] },
  { id: "word", catalogId: /^Microsoft\.Office\.WINWORD\.EXE/i, aliases: ["word", "ms word", "वर्ड"] },
  { id: "powerpoint", catalogId: /^Microsoft\.Office\.POWERPNT\.EXE/i, aliases: ["powerpoint", "power point", "ppt", "पावरपॉइंट", "पावर पॉइंट"] },
  { id: "file-explorer", catalogId: /^Microsoft\.Windows\.Explorer$/i, aliases: ["file explorer", "explorer", "files", "my files", "this pc", "my computer", "फ़ाइल एक्सप्लोरर", "फाइल एक्सप्लोरर"] },
  { id: "settings", catalogId: /^windows\.immersivecontrolpanel_/i, aliases: ["settings", "windows settings", "setting", "सेटिंग्स", "सेटिंग"] },
  { id: "calculator", catalogId: /^Microsoft\.WindowsCalculator_/i, aliases: ["calculator", "calc", "कैलकुलेटर"] },
  { id: "notepad", catalogId: /^Microsoft\.WindowsNotepad_|notepad\.exe$/i, aliases: ["notepad", "note pad", "नोटपैड"] },
  { id: "paint", catalogId: /^Microsoft\.Paint_|mspaint\.exe$/i, aliases: ["paint", "ms paint", "पेंट"] },
  { id: "whatsapp", catalogId: /WhatsAppDesktop/i, aliases: ["whatsapp", "whats app", "watsapp", "whatsapp desktop", "व्हाट्सएप", "व्हाट्सऐप", "वॉट्सऐप", "वॉट्सएप"] },
  { id: "brave", catalogId: /^Brave$/i, aliases: ["brave", "ब्रेव"] },
  { id: "chrome", catalogId: /^Chrome$/i, aliases: ["chrome", "क्रोम"] },
  { id: "edge", catalogId: /^MSEdge$/i, aliases: ["edge", "ms edge", "एज"] },
  { id: "vs-code", catalogId: /VisualStudioCode/i, aliases: ["vs code", "vscode", "visual studio code", "code"] },
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

