import { z } from "zod";

const MAX_SPEECH_CHARS = 240;
/** Control names are flattened to this length in the prompt, so a longer label can't be one of them. */
export const MAX_LABEL_CHARS = 80;
/** Qwen3-VL reports boxes in a 0–1000 space relative to the image. */
export const BOX_SCALE = 1000;
/** Controls after the target that one step may also light, numbered in flow order (2, 3, 4). */
export const MAX_MORE_TARGETS = 3;

/** [x1, y1, x2, y2] in 0–1000 image space. */
const imageBox = z.array(z.number().min(0).max(BOX_SCALE)).length(4);

/** A further control the step walks through after the target, named, numbered and boxed like it. */
const moreTargetSchema = z.object({
  label: z.string().max(MAX_LABEL_CHARS),
  target_index: z.number().int().min(-1),
  bbox: imageBox.optional(),
  /** The words in the speech that name it. Always asked for; a reply without it still stands. */
  mention: z.string().max(MAX_LABEL_CHARS).optional(),
});

export type MoreTarget = z.infer<typeof moreTargetSchema>;

/** What the model must return; enforced by llama-server's json_schema and re-validated here. */
export const visionReplySchema = z.object({
  kind: z.enum(["guide", "answer", "clarify", "complete"]),
  speech: z.string().min(1).max(MAX_SPEECH_CHARS),
  /** Index into the numbered control list, or -1 when no listed control fits. */
  target_index: z.number().int().min(-1),
  /** Around the picked control, or where to act when target_index is -1. */
  bbox: imageBox.optional(),
  confidence: z.number().min(0).max(1),
  /** The pointed-at control's name, copied from the list; grounding checks the index and box against it. Optional for older and cloud replies. */
  target_label: z.string().max(MAX_LABEL_CHARS).optional(),
  /** The step's later controls in the order the learner uses them; absent when it uses one. */
  more_targets: z.array(moreTargetSchema).max(MAX_MORE_TARGETS).optional(),
});

export type VisionReply = z.infer<typeof visionReplySchema>;

const BOX_JSON_SCHEMA = { type: "array", items: { type: "number", minimum: 0, maximum: BOX_SCALE }, minItems: 4, maxItems: 4 } as const;

const MORE_TARGETS_JSON_SCHEMA = {
  type: "array",
  maxItems: MAX_MORE_TARGETS,
  items: {
    type: "object",
    // Label first, as target_label precedes target_index: the model names each control before numbering it.
    properties: {
      label: { type: "string", maxLength: MAX_LABEL_CHARS },
      target_index: { type: "integer", minimum: -1 },
      bbox: BOX_JSON_SCHEMA,
      mention: { type: "string", maxLength: MAX_LABEL_CHARS },
    },
    required: ["label", "target_index", "mention"],
    additionalProperties: false,
  },
} as const;

/** The same contract as JSON Schema, for llama-server's constrained decoding. */
export const VISION_REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["guide", "answer", "clarify", "complete"] },
    speech: { type: "string", maxLength: MAX_SPEECH_CHARS },
    // Before target_index: llama-server writes keys in this order, so the model names the control, then numbers it.
    target_label: { type: "string", maxLength: MAX_LABEL_CHARS },
    target_index: { type: "integer", minimum: -1 },
    bbox: BOX_JSON_SCHEMA,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    // Not required: llama-server writes optional keys after the required ones, so these come last, after the speech they quote.
    more_targets: MORE_TARGETS_JSON_SCHEMA,
  },
  // target_label is required here so the local model always names its target ("" when not pointing).
  required: ["kind", "speech", "target_label", "target_index", "confidence"],
  additionalProperties: false,
} as const;

/** Without a control list the model must point by pixels, so `bbox` becomes mandatory. */
export function replySchemaFor(hasCandidates: boolean) {
  if (hasCandidates) return VISION_REPLY_JSON_SCHEMA;
  return { ...VISION_REPLY_JSON_SCHEMA, required: [...VISION_REPLY_JSON_SCHEMA.required, "bbox"] };
}

export function parseVisionReply(content: string): VisionReply {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`The vision model returned text that isn't JSON: ${content.slice(0, 120)}`);
  }
  return validateReply(raw, "The vision model");
}

/** Same contract for every reasoner (local or cloud), checked here whatever the model claimed. */
export function validateReply(raw: unknown, source: string): VisionReply {
  const result = visionReplySchema.safeParse(raw);
  if (!result.success) throw new Error(`${source}'s reply didn't match the contract: ${z.prettifyError(result.error)}`);
  return result.data;
}
