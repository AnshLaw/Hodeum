import type { TaskPack } from "../lib/types";

const MATCH_THRESHOLD = 0.6;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
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
