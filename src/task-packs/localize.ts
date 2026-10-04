import { z } from "zod";
import type { ReplyLanguage } from "../lib/language";
import type { TaskPack, TaskStep } from "../lib/types";
import hindi from "./hi.json";
import hinglish from "./hinglish.json";

/** A step's words in another language. Targets, signals and skills never change: they match the screen. */
const stepTextSchema = z
  .object({
    objective: z.string().min(1),
    speech: z.object({ demonstrate: z.string().min(1), guide: z.string().min(1), hint: z.string().min(1) }).strict(),
    explain: z.string().min(1),
    /** In the same order as the step's mistakes. */
    corrections: z.array(z.string().min(1)),
  })
  .strict();

const packTextSchema = z
  .object({
    title: z.string().min(1),
    prerequisites: z.array(z.string().min(1)),
    concept: z.string().min(1).optional(),
    steps: z.record(z.string(), stepTextSchema),
  })
  .strict();

type PackText = z.infer<typeof packTextSchema>;
type StepText = z.infer<typeof stepTextSchema>;

const packTexts = z.record(z.string(), packTextSchema);
const TEXTS: Record<Exclude<ReplyLanguage, "en">, Record<string, PackText>> = { hi: packTexts.parse(hindi), hinglish: packTexts.parse(hinglish) };

function localizeStep(step: TaskStep, text: StepText | undefined): TaskStep {
  if (!text) return step;
  return {
    ...step,
    objective: text.objective,
    speech: { ...step.speech, ...text.speech },
    explain: text.explain,
    mistakes: step.mistakes.map((mistake, i) => ({ ...mistake, correction: text.corrections[i] ?? mistake.correction })),
  };
}

/** The pack in the learner's language. Untranslated packs stay English. */
export function localizePack(pack: TaskPack, language: ReplyLanguage): TaskPack {
  const text = language === "en" ? undefined : TEXTS[language][pack.id];
  if (!text) return pack;
  const concept = text.concept ?? pack.concept;
  const localized = { ...pack, title: text.title, prerequisites: text.prerequisites, steps: pack.steps.map((step) => localizeStep(step, text.steps[step.id])) };
  return concept ? { ...localized, concept } : localized;
}

/** For tests: a pack's text in a language, to check every step is covered. */
export const packText = (language: Exclude<ReplyLanguage, "en">, packId: string): PackText | undefined => TEXTS[language][packId];
