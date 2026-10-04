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
    target: z.object({ names, role: z.string().min(1).optional(), label: z.string().min(1).optional() }).strict(),
    speech: speechSchema,
    explain: z.string().min(1),
    success: signalSchema,
    mistakes: z.array(z.object({ signal: signalSchema, correction: z.string().min(1) }).strict()),
  })
  .strict();

const packSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    app: z.string().min(1),
    surface: z.enum(["windows", "phone"]).optional(),
    goalPhrases: names,
    prerequisites: z.array(z.string().min(1)),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

export function loadTaskPack(raw: unknown): TaskPack {
  const result = packSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid task pack: ${z.prettifyError(result.error)}`);
  const pack: TaskPack = result.data;
  return pack;
}
