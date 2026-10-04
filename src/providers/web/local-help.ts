import { HELP_ENTRIES, type HelpEntry } from "../../task-packs/help";
import { appsMentioned, searchableAppId } from "./apps";
import type { WebSearch } from "./types";

/** Shown as the provider of an answer from the offline help: nothing left the PC. */
export const LOCAL_HELP_PROVIDER = "Hodey's offline help";

/** With the app known (in front, or named in the question), one specific shared word is enough. */
const MIN_SCOPED_SCORE = 1;
/** With no app to go on, it takes a phrase or a couple of rare words. */
const MIN_UNSCOPED_SCORE = 3.5;
/** Matching a whole multi-word keyword in order ("pivot table") says more than its words apart. */
const PHRASE_BONUS = 1.5;
/** Runners-up close to the best are kept too ("new tab" with no app: Brave's and Chrome's). */
const NEAR_BEST = 0.75;
const MAX_MATCHES = 2;
/** Plurals fold onto the singular ("files" → "file") for words longer than this. */
const MIN_PLURAL_LENGTH = 3;
/** Settings tasks are system-wide: they apply whatever app is in front. */
const SYSTEM_APPS = new Set(["settings"]);

const STOPWORDS = new Set(
  "a an the to in on of for at by my me i it its this that these those is are am be do does did how can could would should will what whats s when where which who with please hodey hey hi you your want wanna need help way just and or so there here ok okay like some get".split(" "),
);

/** Lowercase words without filler; "%" is a word of its own. */
export function helpTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/%/g, " % ")
    .split(/[^\p{L}\p{N}%]+/u)
    .filter((w) => w !== "" && !STOPWORDS.has(w))
    .map((w) => (w.length > MIN_PLURAL_LENGTH && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

interface Indexed {
  entry: HelpEntry;
  keywords: string[][];
  words: Set<string>;
}

const INDEX: Indexed[] = HELP_ENTRIES.map((entry) => {
  const keywords = entry.keywords.map(helpTokens).filter((k) => k.length > 0);
  return { entry, keywords, words: new Set(keywords.flat()) };
});

/** BM25's inverse document frequency: a word in one entry counts far more than one in many. */
const IDF = new Map(
  [...new Set(INDEX.flatMap((i) => [...i.words]))].map((word) => {
    const df = INDEX.filter((i) => i.words.has(word)).length;
    return [word, Math.log(1 + (INDEX.length - df + 0.5) / (df + 0.5))] as const;
  }),
);

function inOrder(query: string[], phrase: string[]): boolean {
  return query.some((_, start) => phrase.every((word, k) => query[start + k] === word));
}

/** Zero unless at least one keyword is fully in the question. */
function score(item: Indexed, query: string[]): number {
  const asked = new Set(query);
  if (!item.keywords.some((k) => k.every((w) => asked.has(w)))) return 0;
  const words = [...asked].filter((w) => item.words.has(w)).reduce((sum, w) => sum + (IDF.get(w) ?? 0), 0);
  const phrases = item.keywords.filter((k) => k.length > 1 && inOrder(query, k)).length;
  return words + phrases * PHRASE_BONUS;
}

/** The apps an answer may come from, or undefined when any app will do. */
function allowedApps(question: string, appId: string | undefined): Set<string> | undefined {
  const named = appsMentioned(question);
  if (named.length > 0) return new Set([...named, ...SYSTEM_APPS]);
  return appId ? new Set([appId, ...SYSTEM_APPS]) : undefined;
}

/** The help entries that answer `question`, best first; `app` is the app in front (id or friendly name). */
export function matchHelp(question: string, app?: string): HelpEntry[] {
  const query = helpTokens(question);
  if (query.length === 0) return [];
  const allowed = allowedApps(question, searchableAppId(app) ?? app?.toLowerCase());
  const minimum = allowed ? MIN_SCOPED_SCORE : MIN_UNSCOPED_SCORE;
  const scored = INDEX.filter((i) => !allowed || allowed.has(i.entry.app))
    .map((i) => ({ entry: i.entry, score: score(i, query) }))
    .filter((s) => s.score >= minimum)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score >= best * NEAR_BEST)
    .slice(0, MAX_MATCHES)
    .map((s) => s.entry);
}

/** An offline answer shaped like a web search: each entry's numbered steps as its page. */
export function localHelp(question: string, app?: string): WebSearch | undefined {
  const entries = matchHelp(question, app);
  if (entries.length === 0) return undefined;
  return {
    query: question.trim(),
    provider: LOCAL_HELP_PROVIDER,
    results: entries.map((e) => ({ title: e.source.title, url: e.source.url, snippet: e.steps.join(" "), source: LOCAL_HELP_PROVIDER })),
    pages: entries.map((e) => ({ title: e.title, url: e.source.url, text: e.steps.map((step, i) => `${i + 1}. ${step}`).join("\n") })),
    cached: false,
    failures: [],
  };
}
