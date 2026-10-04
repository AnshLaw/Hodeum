import { REPLY_LANGUAGES } from "../../lib/language";
import { spoken } from "../../lib/spoken";
import type { TaskPack } from "../../lib/types";
import { localizePack } from "../../task-packs/localize";

const SENTENCE_END = /(?<=[.!?।])\s+/;

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function packLines(pack: TaskPack): string[] {
  const steps = pack.steps.flatMap((step) => [step.objective, ...Object.values(step.speech), step.explain, ...step.mistakes.map((m) => m.correction)]);
  return [pack.title, ...steps];
}

/** Hodey's fixed phrases; templated ones (which carry a control or app name) are left out on purpose. */
function fixedLines(): string[] {
  return REPLY_LANGUAGES.flatMap((language) =>
    Object.values(spoken(language)).flatMap((value) => (typeof value === "string" ? [value] : Array.isArray(value) ? value : [])),
  );
}

/** Every sentence Hodey may say through a cloud voice: the task packs in each language, and its fixed phrases. */
export function lessonCorpus(packs: TaskPack[]): Set<string> {
  const lines = packs.flatMap((pack) => REPLY_LANGUAGES.flatMap((language) => packLines(localizePack(pack, language))));
  return new Set([...lines, ...fixedLines()].flatMap(sentences));
}

/**
 * Whether a line may go to the cloud voice: only when every sentence is a known lesson or fixed line.
 * Answers and vision guidance come from the screen, so they stay on the local voice whatever the Hode's phase.
 */
export function shareableText(text: string, corpus: ReadonlySet<string>): boolean {
  const parts = sentences(text);
  return parts.length > 0 && parts.every((sentence) => corpus.has(sentence));
}
