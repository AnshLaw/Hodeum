import type { TaskPack } from "../lib/types";

const MATCH_THRESHOLD = 0.6;

/** Devanagari's nukta (ज़ vs ज): speech recognition writes it inconsistently, so it's ignored. */
const NUKTA = /\u093C/g;

function tokens(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(NUKTA, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Fraction of the phrase's words that appear in the goal. */
export function goalScore(goal: string, phrase: string): number {
  const goalTokens = new Set(tokens(goal));
  const phraseTokens = tokens(phrase);
  if (phraseTokens.length === 0) return 0;
  return phraseTokens.filter((t) => goalTokens.has(t)).length / phraseTokens.length;
}

export function matchGoal(goal: string, packs: TaskPack[]): TaskPack | undefined {
  let best: { pack: TaskPack; score: number } | undefined;
  for (const pack of packs) {
    for (const phrase of pack.goalPhrases) {
      const score = goalScore(goal, phrase);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { pack, score };
    }
  }
  return best?.pack;
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
