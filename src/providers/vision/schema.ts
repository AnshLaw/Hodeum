import { z } from "zod";

const MAX_SPEECH_CHARS = 240;
/** Qwen3-VL reports boxes in a 0–1000 space relative to the image. */
export const BOX_SCALE = 1000;

/** What the model must return; enforced by llama-server's json_schema and re-validated here. */
export const visionReplySchema = z.object({
  kind: z.enum(["guide", "answer", "clarify", "complete"]),
  speech: z.string().min(1).max(MAX_SPEECH_CHARS),
  /** Index into the numbered control list, or -1 when no listed control fits. */
  target_index: z.number().int().min(-1),
  /** Only when target_index is -1: [x1, y1, x2, y2] in 0–1000 image space. */
  bbox: z.array(z.number().min(0).max(BOX_SCALE)).length(4).optional(),
  confidence: z.number().min(0).max(1),
});

export type VisionReply = z.infer<typeof visionReplySchema>;

/** The same contract as JSON Schema, for llama-server's constrained decoding. */
export const VISION_REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["guide", "answer", "clarify", "complete"] },
    speech: { type: "string", maxLength: MAX_SPEECH_CHARS },
    target_index: { type: "integer", minimum: -1 },
    bbox: { type: "array", items: { type: "number", minimum: 0, maximum: BOX_SCALE }, minItems: 4, maxItems: 4 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["kind", "speech", "target_index", "confidence"],
  additionalProperties: false,
} as const;

export function parseVisionReply(content: string): VisionReply {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error(`The vision model returned text that isn't JSON: ${content.slice(0, 120)}`);
  }
  const result = visionReplySchema.safeParse(raw);
  if (!result.success) throw new Error(`The vision model's reply didn't match the contract: ${z.prettifyError(result.error)}`);
  return result.data;
}
