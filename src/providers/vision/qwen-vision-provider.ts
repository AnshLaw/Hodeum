import type { ActionTarget, Rect, TeachingAction, TeachingContext, UiElement } from "../../lib/types";
import type { ReasoningHooks, ReasoningProvider } from "../interfaces";
import { agreementConfidence, type Resolution } from "./grounding";
import { buildMessages, fromImageBox, insideFrame, selectCandidates } from "./prompt";
import { parseVisionReply, replySchemaFor, type MoreTarget, type VisionReply } from "./schema";
import { firstQuotes, laterTargets, namesOf, resolveNamed, targetsField, withMention } from "./targets";
import type { CapturedFrame, VisionConnection } from "./types";

/** A slow answer is worse than the deterministic fallback; the notch shows "looking" meanwhile. */
export const VISION_TIMEOUT_MS = 20_000;
/** Boxes from pixels alone never earn a precise arrow (PRD §37): they draw a broad highlight at most. */
export const VISUAL_CONFIDENCE_CAP = 0.8;
/** Room for a full reply with three later controls; the schema closes a typical one well before. */
const MAX_TOKENS = 320;
/** A "target" covering most of the window points at nothing; better to draw no highlight at all. */
const MAX_BOX_SHARE = 0.5;
const TEMPERATURE = 0.2;
const GENERAL_SKILL = "general.vision";
const MS_PER_SECOND = 1000;
/** How much of a bad reply to quote in an error. */
const SNIPPET_CHARS = 160;
const EVENT_STREAM = "text/event-stream";
const SSE_DONE = "[DONE]";

export interface QwenVisionDeps {
  /** Undefined until the local server reports ready. */
  connection: () => VisionConnection | undefined;
  /** A capture of the learner's app; `windowId` is the window the screen read came from, when known. */
  capture: (windowId?: number) => Promise<CapturedFrame>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The screenshot shows another window than the screen read did: guidance would mix two apps. Looking again fixes it. */
export class WindowChangedError extends Error {
  constructor() {
    super("The app changed while Hodey was looking.");
    this.name = "WindowChangedError";
  }
}

/** Local Qwen3-VL via llama-server's OpenAI-compatible API. Screenshots never leave the machine. */
export class QwenVisionProvider implements ReasoningProvider {
  readonly id = "local-qwen3-vl";

  constructor(private readonly deps: QwenVisionDeps) {}

  async reason(context: TeachingContext, hooks?: ReasoningHooks): Promise<TeachingAction> {
    hooks?.signal?.throwIfAborted();
    const expected = context.observation.window?.id;
    const frame = await this.deps.capture(expected);
    if (frame.windowId !== undefined && expected !== undefined && frame.windowId !== expected) throw new WindowChangedError();
    hooks?.signal?.throwIfAborted();
    const candidates = selectCandidates(context);
    const reply = await this.ask(buildMessages(context, candidates, frame), candidates.length > 0, hooks?.signal);
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

  /**
   * Streams the reply so that calling it off (the Hode moved on) closes the connection and the server
   * stops generating. A called-off request rethrows the caller's abort: stale, not a provider failure.
   */
  private async ask(messages: unknown[], hasCandidates: boolean, stale?: AbortSignal): Promise<VisionReply> {
    const connection = this.deps.connection();
    if (!connection) throw new Error("The local vision model isn't running.");
    const timeoutMs = this.deps.timeoutMs ?? VISION_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = stale ? AbortSignal.any([stale, timeout]) : timeout;
    try {
      const response = await (this.deps.fetch ?? fetch)(`${connection.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
        signal,
        body: JSON.stringify({
          messages,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          stream: true,
          response_format: { type: "json_schema", json_schema: { name: "teaching_action", schema: replySchemaFor(hasCandidates) } },
        }),
      });
      return parseVisionReply(await replyText(response));
    } catch (error) {
      stale?.throwIfAborted();
      if (timeout.aborted) throw new Error(`The vision model took longer than ${timeoutMs / MS_PER_SECOND} s to answer.`, { cause: error });
      throw error;
    }
  }
}

async function replyText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`The vision model answered ${response.status}: ${(await response.text()).slice(0, SNIPPET_CHARS)}`);
  const streamed = response.headers.get("content-type")?.includes(EVENT_STREAM) && response.body;
  const content = streamed ? await collectStream(streamed) : await messageContent(response);
  if (!content) throw new Error("The vision model sent an empty reply.");
  return content;
}

/** A whole (non-streamed) reply: a server that ignored `stream`, or a test double. */
async function messageContent(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`The vision model sent an empty reply: ${JSON.stringify(body).slice(0, SNIPPET_CHARS)}`);
  return content;
}

/** The text of one server-sent event's delta; llama-server reports a failure mid-stream as an `error` event. */
function deltaOf(data: string): string {
  let parsed: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
  try {
    parsed = JSON.parse(data) as typeof parsed;
  } catch {
    throw new Error(`The vision model's reply stream had a malformed event: ${data.slice(0, SNIPPET_CHARS)}`);
  }
  if (parsed.error) throw new Error(`The vision model failed mid-reply: ${parsed.error.message ?? "unknown error"}`);
  return parsed.choices?.[0]?.delta?.content ?? "";
}

/** The reply text from an OpenAI-style event stream, read to its end. */
export async function collectStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : (events.pop() ?? "");
    for (const event of events) {
      const data = event.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice("data:".length).trim();
      if (data && data !== SSE_DONE) text += deltaOf(data);
    }
    if (done) return text;
  }
}

/** The model's box in screen px, unless it's off the window or covers most of it (pointing at nothing). */
function boxOf(bbox: number[] | undefined, frame: CapturedFrame): Rect | undefined {
  if (!bbox) return undefined;
  const bounds = fromImageBox(bbox, frame.rect);
  const share = (bounds.width * bounds.height) / (frame.rect.width * frame.rect.height);
  return insideFrame(bounds, frame.rect) && share <= MAX_BOX_SHARE ? bounds : undefined;
}

/** The names the model gave its target: target_label, then any it quoted in its speech for it (not for a later control). */
function labelsOf(reply: VisionReply): string[] {
  const labels = [reply.target_label?.trim() ?? "", ...firstQuotes(reply.speech, reply.more_targets)].filter((label) => label !== "");
  return [...new Set(labels)];
}

/** A control from the screen read, settled by the name the model gave it and checked against its index and box; else the bare box. */
function targetFrom(reply: VisionReply, candidates: UiElement[], frame: CapturedFrame, context: TeachingContext): ActionTarget | undefined {
  const box = boxOf(reply.bbox, frame);
  const chosen = reply.target_index >= 0 ? candidates[reply.target_index] : undefined;
  const labels = labelsOf(reply);
  const resolution = resolveNamed(context, { chosen, box, labels });
  console.debug("Vision grounding", { label: labels[0], index: chosen?.name, agreement: resolution.agreement, target: resolution.element?.name });
  // The model's own confidence is near-constant (0.95), so it only ever caps what grounding found.
  const confidence = Math.min(reply.confidence, agreementConfidence(resolution));
  const { element } = resolution;
  if (element) return withMention({ elementId: element.id, bounds: element.bounds, confidence, label: element.name }, reply.speech, [reply.target_label, element.name]);
  if (!resolution.box) return undefined;
  return withMention({ elementId: "vision-box", bounds: resolution.box, confidence: Math.min(confidence, VISUAL_CONFIDENCE_CAP), label: "Here" }, reply.speech, [reply.target_label]);
}

/** A later control of the step, settled like the target: its own name first, then its number and box. */
function settleLater(item: MoreTarget, candidates: UiElement[], frame: CapturedFrame, context: TeachingContext): Resolution {
  const chosen = item.target_index >= 0 ? candidates[item.target_index] : undefined;
  return resolveNamed(context, { chosen, box: boxOf(item.bbox, frame), labels: namesOf(item) });
}

export function toAction(reply: VisionReply, candidates: UiElement[], frame: CapturedFrame, context: TeachingContext): TeachingAction {
  const kind = context.correction && reply.kind === "guide" ? "correct" : reply.kind;
  const target = kind === "clarify" || kind === "complete" ? undefined : targetFrom(reply, candidates, frame, context);
  const settle = (item: MoreTarget) => settleLater(item, candidates, frame, context);
  const targets = laterTargets({ items: reply.more_targets ?? [], first: target, speech: reply.speech, confidence: reply.confidence, settle });
  return {
    kind,
    speech: reply.speech.trim(),
    target,
    ...targetsField(targets),
    skill: context.step?.skill ?? GENERAL_SKILL,
    assistanceLevel: context.assistanceLevel,
  };
}
