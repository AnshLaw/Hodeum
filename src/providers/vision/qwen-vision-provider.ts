import type { ActionTarget, Rect, TeachingAction, TeachingContext, UiElement } from "../../lib/types";
import type { ReasoningProvider } from "../interfaces";
import { groundTarget } from "./grounding";
import { buildMessages, fromImageBox, insideFrame, selectCandidates } from "./prompt";
import { parseVisionReply, replySchemaFor, type VisionReply } from "./schema";
import type { CapturedFrame, VisionConnection } from "./types";

/** A slow answer is worse than the deterministic fallback; the notch shows "looking" meanwhile. */
export const VISION_TIMEOUT_MS = 20_000;
/** Boxes from pixels alone never earn a precise arrow (PRD §37): they draw a broad highlight at most. */
export const VISUAL_CONFIDENCE_CAP = 0.8;
const MAX_TOKENS = 200;
/** A "target" covering most of the window points at nothing; better to draw no highlight at all. */
const MAX_BOX_SHARE = 0.5;
const TEMPERATURE = 0.2;
const GENERAL_SKILL = "general.vision";

export interface QwenVisionDeps {
  /** Undefined until the local server reports ready. */
  connection: () => VisionConnection | undefined;
  capture: () => Promise<CapturedFrame>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Local Qwen3-VL via llama-server's OpenAI-compatible API. Screenshots never leave the machine. */
export class QwenVisionProvider implements ReasoningProvider {
  readonly id = "local-qwen3-vl";

  constructor(private readonly deps: QwenVisionDeps) {}

  async reason(context: TeachingContext): Promise<TeachingAction> {
    const frame = await this.deps.capture();
    const candidates = selectCandidates(context);
    const reply = await this.ask(buildMessages(context, candidates, frame), candidates.length > 0);
    return toAction(reply, candidates, frame, context);
  }

  async healthCheck(): Promise<boolean> {
    const connection = this.deps.connection();
    if (!connection) return false;
    try {
      const response = await (this.deps.fetch ?? fetch)(`${connection.endpoint}/health`);
      return response.ok;
    } catch (error) {
      console.error("Local vision model health check failed", error);
      return false;
    }
  }

  private async ask(messages: unknown[], hasCandidates: boolean): Promise<VisionReply> {
    const connection = this.deps.connection();
    if (!connection) throw new Error("The local vision model isn't running.");
    const response = await (this.deps.fetch ?? fetch)(`${connection.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? VISION_TIMEOUT_MS),
      body: JSON.stringify({
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_schema", json_schema: { name: "teaching_action", schema: replySchemaFor(hasCandidates) } },
      }),
    });
    if (!response.ok) throw new Error(`The vision model answered ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`The vision model sent an empty reply: ${JSON.stringify(body).slice(0, 160)}`);
    return parseVisionReply(content);
  }
}

/** The model's box in screen px, unless it's off the window or covers most of it (pointing at nothing). */
function boxOf(reply: VisionReply, frame: CapturedFrame): Rect | undefined {
  if (!reply.bbox) return undefined;
  const bounds = fromImageBox(reply.bbox, frame.rect);
  const share = (bounds.width * bounds.height) / (frame.rect.width * frame.rect.height);
  return insideFrame(bounds, frame.rect) && share <= MAX_BOX_SHARE ? bounds : undefined;
}

/** A control from the screen read, checked against the model's box and the learner's words; else the bare box. */
function targetFrom(reply: VisionReply, candidates: UiElement[], frame: CapturedFrame, context: TeachingContext): ActionTarget | undefined {
  const box = boxOf(reply, frame);
  const chosen = reply.target_index >= 0 ? candidates[reply.target_index] : undefined;
  const element = groundTarget({ chosen, box, elements: context.observation.elements, utterance: context.utterance });
  if (element) {
    return { elementId: element.id, bounds: element.bounds, confidence: Math.min(reply.confidence, element.confidence), label: element.name };
  }
  if (!box) return undefined;
  return { elementId: "vision-box", bounds: box, confidence: Math.min(reply.confidence, VISUAL_CONFIDENCE_CAP), label: "Here" };
}

export function toAction(reply: VisionReply, candidates: UiElement[], frame: CapturedFrame, context: TeachingContext): TeachingAction {
  const kind = context.correction && reply.kind === "guide" ? "correct" : reply.kind;
  return {
    kind,
    speech: reply.speech.trim(),
    target: kind === "clarify" || kind === "complete" ? undefined : targetFrom(reply, candidates, frame, context),
    skill: context.step?.skill ?? GENERAL_SKILL,
    assistanceLevel: context.assistanceLevel,
  };
}
