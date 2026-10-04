import { z } from "zod";
import type { TaskPack } from "../lib/types";

const SKILL_ID_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

const names = z.array(z.string().min(1)).min(1);

const signalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("element_visible"), names }).strict(),
  z.object({ kind: z.literal("element_absent"), names }).strict(),
  z.object({ kind: z.literal("element_selected"), names }).strict(),
  z.object({ kind: z.literal("window_title_contains"), text: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("screen_tone"), tone: z.enum(["dark", "light"]), names: names.optional() }).strict(),
]);

const speechSchema = z
  .object({
    demonstrate: z.string().min(1),
    guide: z.string().min(1),
    hint: z.string().min(1),
    observe: z.string(),
    independent: z.string(),
  })
  .strict();

// `.strict()` everywhere: unknown keys such as `bbox` or `x` are rejected, so packs can never carry coordinates.
const stepSchema = z
  .object({
    id: z.string().min(1),
    objective: z.string().min(1),
    skill: z.string().regex(SKILL_ID_PATTERN, "skill ids look like app.area.skill"),
    target: z.object({ names, role: z.union([z.string().min(1), names]).optional(), label: z.string().min(1).optional(), prefer: z.literal("selected").optional() }).strict(),
    speech: speechSchema,
    explain: z.string().min(1),
    success: signalSchema,
    mistakes: z.array(z.object({ signal: signalSchema, correction: z.string().min(1) }).strict()),
    press: z.enum(["left", "right"]).optional(),
    checkpoint: z.boolean().optional(),
  })
  .strict();

/** Most answers a recall question offers: more would crowd the notch. */
const MAX_CHECK_OPTIONS = 4;

const checkSchema = z
  .object({ question: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(MAX_CHECK_OPTIONS), answer: z.number().int().min(0), explain: z.string().min(1) })
  .strict()
  .refine((check) => check.answer < check.options.length, "a check's answer must be one of its options");

const packSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    app: z.string().min(1),
    launch: z.object({ exe: z.string().min(1), sample: z.string().min(1).optional() }).strict().optional(),
    surface: z.enum(["windows", "phone"]).optional(),
    goalPhrases: names,
    notFor: names.optional(),
    prerequisites: z.array(z.string().min(1)),
    concept: z.string().min(1).optional(),
    recap: z.string().min(1).optional(),
    check: checkSchema.optional(),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

export function loadTaskPack(raw: unknown): TaskPack {
  const result = packSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid task pack: ${z.prettifyError(result.error)}`);
  const pack: TaskPack = result.data;
  return pack;
}
