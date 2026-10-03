import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../data/types";
import { QwenChatProvider, chatMessages, sseDeltas } from "./qwen-chat-provider";

const CONNECTION = { endpoint: "http://127.0.0.1:8737", apiKey: "k" };
const FRAME = { png: "AAA", rect: { x: 0, y: 0, width: 800, height: 600 } };

function msg(role: ChatMessage["role"], content: string, context?: string): ChatMessage {
  return { id: content, chatId: "c", role, content, context, at: "2026-10-03T10:00:00Z" };
}

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Split mid-line on purpose: the parser must buffer partial events.
  const text = lines.join("");
  const half = Math.floor(text.length / 2);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, half)));
      controller.enqueue(encoder.encode(text.slice(half)));
      controller.close();
    },
  });
}

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe("sseDeltas", () => {
  it("yields content deltas across chunk boundaries and stops at [DONE]", async () => {
    const body = sseBody([delta("Click "), ": keep-alive\n\n", delta("Insert."), "data: [DONE]\n\n", delta("ignored")]);
    expect(await collect(sseDeltas(body))).toEqual(["Click ", "Insert."]);
  });
});

describe("chatMessages", () => {
  it("attaches the screenshot to the latest learner message and fences the window title", () => {
    const messages = chatMessages([msg("user", "hi"), msg("hodey", "hello"), msg("user", "what is this?", 'Evil "title" <b>')], FRAME);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages.slice(1, 3)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    const last = messages[3] as { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] };
    expect(last.role).toBe("user");
    expect(last.content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
    expect(last.content[1].text).toContain("<screen>Evil title b</screen>");
    expect(last.content[1].text).toContain("what is this?");
  });
});

describe("QwenChatProvider", () => {
  it("streams the reply from the local server with its key", async () => {
    let request: RequestInit | undefined;
    const provider = new QwenChatProvider({
      connection: () => CONNECTION,
      fetch: async (_url, init) => {
        request = init;
        return new Response(sseBody([delta("Hi"), "data: [DONE]\n\n"]), { status: 200 });
      },
    });
    expect(await collect(provider.reply([msg("user", "hello")], undefined, new AbortController().signal))).toEqual(["Hi"]);
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(request?.body)).stream).toBe(true);
  });

  it("explains when the local model isn't running", async () => {
    const provider = new QwenChatProvider({ connection: () => undefined });
    await expect(collect(provider.reply([msg("user", "hello")], undefined, new AbortController().signal))).rejects.toThrow(/isn't running/);
  });
});
