// OpenRouter (OpenAI-compatible chat completions), for running the web chat on free models while
// there is no ANTHROPIC_API_KEY. Plain fetch + SSE parsing; no SDK.

const DEFAULT_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
];

/** OPENROUTER_MODEL may list several, comma-separated; OpenRouter falls through them in order. */
export const OPENROUTER_MODELS = process.env.OPENROUTER_MODEL
  ? process.env.OPENROUTER_MODEL.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_MODELS;

export type ORToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ORMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ORToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ORTool = { type: "function"; function: { name: string; description: string; parameters: unknown } };

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Which backend runs the web chat. VYBD_PROVIDER wins; otherwise Anthropic if its key is set. */
export function chatProvider(): "anthropic" | "openrouter" | "demo" {
  if (process.env.VYBD_DEMO === "1") return "demo";
  const forced = process.env.VYBD_PROVIDER;
  if (forced === "anthropic" || forced === "openrouter") return forced;
  if (!process.env.ANTHROPIC_API_KEY && process.env.OPENROUTER_API_KEY) return "openrouter";
  return "anthropic";
}

/** Stream one completion. Text deltas go to onText; tool calls are assembled from their deltas. */
export async function streamCompletion(
  input: { messages: ORMessage[]; tools: ORTool[]; signal?: AbortSignal },
  onText: (delta: string) => void,
): Promise<{ content: string; toolCalls: ORToolCall[]; finishReason: string | null }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new OpenRouterError("The agent is not configured (set OPENROUTER_API_KEY).");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "Vybd",
    },
    body: JSON.stringify({
      models: OPENROUTER_MODELS,
      messages: input.messages,
      tools: input.tools,
      stream: true,
    }),
    signal: input.signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new OpenRouterError(`OpenRouter ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  let content = "";
  let finishReason: string | null = null;
  const calls: ORToolCall[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue; // comments like ": OPENROUTER PROCESSING"
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      const chunk = JSON.parse(data) as {
        error?: { message?: string; code?: number };
        choices?: {
          delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
          finish_reason?: string | null;
        }[];
      };
      if (chunk.error) throw new OpenRouterError(chunk.error.message ?? "OpenRouter stream error", chunk.error.code);
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        content += choice.delta.content;
        onText(choice.delta.content);
      }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.function.name += tc.function.name;
        if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return { content, toolCalls, finishReason };
}

export function describeOpenRouterError(err: unknown): string {
  if (err instanceof OpenRouterError) {
    if (err.status === 401) return "The agent is not configured (invalid OPENROUTER_API_KEY).";
    if (err.status === 429) return "The free model is rate-limited right now. Wait a minute and try again.";
    if (err.status === undefined && /OPENROUTER_API_KEY/.test(err.message)) return err.message;
    return `The agent hit an error (${err.status ?? "stream"}). Try again.`;
  }
  return "Something went wrong. Try again.";
}
