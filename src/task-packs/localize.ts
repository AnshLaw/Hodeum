import { z } from "zod";
import type { ReplyLanguage } from "../lib/language";
import type { TaskPack, TaskStep } from "../lib/types";
import hindi from "./hi.json";

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
    steps: z.record(z.string(), stepTextSchema),
  })
  .strict();

type PackText = z.infer<typeof packTextSchema>;
type StepText = z.infer<typeof stepTextSchema>;

const HINDI: Record<string, PackText> = z.record(z.string(), packTextSchema).parse(hindi);

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

/** The pack in the learner's language: Hindi and Hinglish use the Hindi text. Untranslated packs stay English. */
export function localizePack(pack: TaskPack, language: ReplyLanguage): TaskPack {
  const text = language === "en" ? undefined : HINDI[pack.id];
  if (!text) return pack;
  return { ...pack, title: text.title, prerequisites: text.prerequisites, steps: pack.steps.map((step) => localizeStep(step, text.steps[step.id])) };
}

/** For tests: the Hindi text of a pack, to check every step is covered. */
export const hindiText = (packId: string): PackText | undefined => HINDI[packId];
