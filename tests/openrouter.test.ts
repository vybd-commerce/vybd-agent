import { afterEach, describe, expect, it, vi } from "vitest";
import { streamCompletion } from "@/lib/openrouter";

function sse(chunks: unknown[]) {
  const body = [": OPENROUTER PROCESSING", ...chunks.map((c) => `data: ${JSON.stringify(c)}`), "data: [DONE]", ""].join("\n");
  // Split mid-line to exercise buffering.
  const parts = [body.slice(0, 50), body.slice(50, 140), body.slice(140)];
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });
}

describe("streamCompletion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams text and assembles tool calls from deltas", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          sse([
            { choices: [{ delta: { content: "Got it. " } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "update_brand_brief", arguments: '{"fields":' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"oneLiner":"x"}}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ]),
        ),
      ),
    );
    const deltas: string[] = [];
    const res = await streamCompletion({ messages: [{ role: "user", content: "hi" }], tools: [] }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("Got it. ");
    expect(res.finishReason).toBe("tool_calls");
    expect(res.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "update_brand_brief", arguments: '{"fields":{"oneLiner":"x"}}' } },
    ]);
  });

  it("surfaces HTTP errors with status", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(streamCompletion({ messages: [], tools: [] }, () => {})).rejects.toMatchObject({ status: 429 });
  });
});
