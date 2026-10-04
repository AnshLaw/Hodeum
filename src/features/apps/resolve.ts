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
/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently. */
const NUKTA = /़/g;

/** Lowercase words without "Microsoft", "the", "app" and the like, on both the query and the names. */
export function normalizeName(text: string): string {
  const words = text
    .normalize("NFC")
    .replace(NUKTA, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words.replace(LEADING, "").replace(TRAILING, "").trim();
}

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

export function resolveApp(query: string, catalog: InstalledApp[]): AppMatch {
  const normal = normalizeName(query);
  if (normal === "") return { kind: "none" };
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

