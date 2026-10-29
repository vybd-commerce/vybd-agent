import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.VYBD_MODEL || "claude-opus-5-5";

// Server-side refusal fallback: on a policy decline the API re-runs the request on a fallback model.
export const FALLBACK_PARAMS: { betas: Anthropic.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export class AgentUnavailableError extends Error {}

export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The agent is not configured (invalid ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "The agent is busy right now. Try again in a moment.";
  if (err instanceof Anthropic.APIError) return `The agent hit an error (${err.status ?? "network"}). Try again.`;
  if (err instanceof Error && /api key|apiKey|authentication/i.test(err.message)) {
    return "The agent is not configured (set ANTHROPIC_API_KEY).";
  }
  return "Something went wrong. Try again.";
}
