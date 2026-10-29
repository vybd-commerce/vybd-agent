import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, describeAnthropicError, FALLBACK_PARAMS, MODEL } from "@/lib/anthropic";
import { type BriefDiff, formatValue, BRIEF_FIELDS } from "@/lib/brief";
import { getBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { appendMessage, listMessages, type Message } from "@/lib/services/conversations";
import { getFeedback } from "@/lib/services/feedback";
import { listJobs, type JobView } from "@/lib/services/jobs";
import { jsonSchemaFor, runTool, TOOLS } from "@/lib/tools";
import { DEFAULT_NEXT_STEPS, type MessageAttachments, type NextStep, type NextStepKind } from "@/lib/types";
import { ORCHESTRATOR_SYSTEM } from "./prompts";

export type ChatEvent =
  | { type: "user_message"; message: Message }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "done" | "error" }
  | { type: "brief"; version: number; changed: string[] }
  | { type: "job"; jobId: string }
  | { type: "chips"; chips: string[] }
  | { type: "next_steps"; steps: NextStep[] }
  | { type: "done"; message: Message }
  | { type: "error"; error: string; message?: Message };

const NEXT_STEP_KINDS = DEFAULT_NEXT_STEPS.map((s) => s.kind) as [NextStepKind, ...NextStepKind[]];

// UI-only tools for our web chat. MCP hosts render their own UI, so these never leave the orchestrator.
const UI_TOOLS = {
  suggest_replies: {
    description: "Show 2–4 quick-reply chips under your message. The founder taps one to send it as their answer.",
    input: z.object({ chips: z.array(z.string().max(60)).min(1).max(4) }),
  },
  suggest_next_steps: {
    description: "Show next-step cards (market_snapshot, share_page, find_suppliers) under your message.",
    input: z.object({ steps: z.array(z.enum(NEXT_STEP_KINDS)).min(1).max(3) }),
  },
} as const;

// Web chat is scoped to one brand: brand-picking tools are dropped and brandId is injected.
const WEB_TOOLS = TOOLS.filter((t) => t.name !== "list_brands" && t.name !== "create_brand");

function buildTools(): Anthropic.Beta.BetaTool[] {
  const domain = WEB_TOOLS.map((t) => {
    const input = "brandScoped" in t && t.brandScoped ? (t.input as z.ZodObject).omit({ brandId: true }) : t.input;
    return {
      name: t.name,
      description: t.description,
      input_schema: jsonSchemaFor(input as z.ZodObject) as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    };
  });
  const ui = Object.entries(UI_TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: jsonSchemaFor(t.input) as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
  return [...domain, ...ui];
}

const TOOL_DEFS = buildTools();

async function brandState(ctx: Ctx, brandId: string) {
  const [brief, jobs, feedback] = await Promise.all([
    getBrandBrief(ctx, brandId),
    listJobs(ctx, brandId),
    getFeedback(ctx, brandId),
  ]);
  const fields = BRIEF_FIELDS.map((k) => `${k}: ${formatValue(brief.fields[k]) || "(empty)"}`).join("\n");
  const jobLines = jobs.length
    ? jobs.map((j) => `- ${j.title} [${j.id}] ${j.status}${j.priceCents ? ` $${j.priceCents / 100}` : ""}`).join("\n")
    : "(none)";
  const fb = feedback.published
    ? `Share page live at ${feedback.url}: ${feedback.total} responses (yes ${feedback.counts.yes}, maybe ${feedback.counts.maybe}, no ${feedback.counts.no}).`
    : "Share page not published.";
  return `<brand_state>
Brand: ${brief.name} (stage: ${brief.stage}, brief v${brief.version}, usable: ${brief.usable ? "yes" : "no"})
${fields}

Jobs:
${jobLines}

${fb}
</brand_state>`;
}

/** Rebuild model history from stored messages. Job and operator notes become assistant text. */
function toHistory(rows: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of rows.slice(-40)) {
    if (!m.content.trim()) continue;
    const role = m.role === "user" ? "user" : "assistant";
    const text = m.role === "operator" ? `(Message from a Vybd operator) ${m.content}` : m.content;
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += `\n\n${text}`;
    } else {
      out.push({ role, content: text });
    }
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(conversation start)" });
  return out;
}

/**
 * Run one founder turn: stream the reply, execute tools against the service layer, and persist
 * the assistant message with its attachments (brief diff, job cards, chips, next steps).
 */
export async function runChatTurn(opts: {
  ctx: Ctx;
  brandId: string;
  conversationId: string;
  text: string;
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
}) {
  const { ctx, brandId, conversationId, emit } = opts;
  const history = toHistory(await listMessages(ctx, conversationId));
  const userMessage = await appendMessage(conversationId, { role: "user", content: opts.text });
  emit({ type: "user_message", message: userMessage });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: await brandState(ctx, brandId) },
        { type: "text", text: opts.text },
      ],
    },
  ];
  if (history.length && history[history.length - 1].role === "user") {
    // Two user turns in a row (e.g. a previous reply failed). The API merges them; keep it explicit.
    messages.splice(history.length, 0, { role: "assistant", content: "(no reply)" });
  }

  let text = "";
  const attachments: MessageAttachments = {};
  const briefDiff: BriefDiff = {};
  const jobRefs: string[] = [];
  let jsonRetries = 0;

  try {
    for (let turn = 0; turn < 10; turn++) {
      const stream = anthropic().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          ...FALLBACK_PARAMS,
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          system: ORCHESTRATOR_SYSTEM,
          tools: TOOL_DEFS,
          messages,
        },
        { signal: opts.signal },
      );
      stream.on("text", (delta) => {
        text += delta;
        emit({ type: "text", delta });
      });

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming, unparseable tool JSON rejects here. Retry that turn only.
        if (err instanceof Anthropic.APIError || opts.signal?.aborted || jsonRetries++ >= 2) throw err;
        continue;
      }

      if (message.stop_reason === "refusal") {
        if (!text) {
          text = "I can't help with that one. Want to get back to shaping the brand?";
          emit({ type: "text", delta: text });
        }
        break;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;
      if (message.stop_reason === "max_tokens") throw new Error("Reply was cut off.");

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        results.push(await executeTool(use, { ctx, brandId, emit, attachments, briefDiff, jobRefs }));
      }
      messages.push({ role: "user", content: results });
      if (text && !text.endsWith("\n")) text += "\n\n";
    }
  } catch (err) {
    const aborted = opts.signal?.aborted;
    const error = aborted ? "Stopped." : describeAnthropicError(err);
    if (!aborted) console.error("[chat] turn failed", err);
    const saved = await persist();
    emit({ type: "error", error, message: saved ?? undefined });
    return;
  }

  // Never a dead end: a usable brief with no suggested follow-up gets the default next steps.
  if (!attachments.chips?.length && !attachments.nextSteps?.length) {
    const brief = await getBrandBrief(ctx, brandId);
    if (brief.usable) {
      attachments.nextSteps = DEFAULT_NEXT_STEPS;
      emit({ type: "next_steps", steps: DEFAULT_NEXT_STEPS });
    }
  }
  const saved = await persist();
  if (saved) emit({ type: "done", message: saved });

  async function persist() {
    if (Object.keys(briefDiff).length) attachments.briefDiff = briefDiff;
    if (jobRefs.length) attachments.jobRefs = jobRefs;
    if (!text.trim() && Object.keys(attachments).length === 0) return null;
    return appendMessage(conversationId, { role: "assistant", content: text.trim(), attachments });
  }
}

async function executeTool(
  use: Anthropic.Beta.BetaToolUseBlock,
  s: {
    ctx: Ctx;
    brandId: string;
    emit: (e: ChatEvent) => void;
    attachments: MessageAttachments;
    briefDiff: BriefDiff;
    jobRefs: string[];
  },
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const ok = (content: unknown): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: use.id,
    content: typeof content === "string" ? content : JSON.stringify(content),
  });
  const fail = (error: string): Anthropic.Beta.BetaToolResultBlockParam => {
    s.emit({ type: "tool", name: use.name, status: "error" });
    return { type: "tool_result", tool_use_id: use.id, is_error: true, content: error };
  };

  if (use.name === "suggest_replies") {
    const parsed = UI_TOOLS.suggest_replies.input.safeParse(use.input);
    if (!parsed.success) return fail(z.prettifyError(parsed.error));
    s.attachments.chips = parsed.data.chips;
    s.emit({ type: "chips", chips: parsed.data.chips });
    return ok("Chips shown.");
  }
  if (use.name === "suggest_next_steps") {
    const parsed = UI_TOOLS.suggest_next_steps.input.safeParse(use.input);
    if (!parsed.success) return fail(z.prettifyError(parsed.error));
    const steps = DEFAULT_NEXT_STEPS.filter((st) => parsed.data.steps.includes(st.kind));
    s.attachments.nextSteps = steps;
    s.emit({ type: "next_steps", steps });
    return ok("Next steps shown.");
  }

  s.emit({ type: "tool", name: use.name, status: "start" });
  const def = TOOLS.find((t) => t.name === use.name);
  const input = { ...(use.input as Record<string, unknown>) };
  if (def && "brandScoped" in def && def.brandScoped) input.brandId = s.brandId;
  const res = await runTool(use.name, input, { ctx: s.ctx, surface: "web" });
  if (!res.ok) return fail(res.error);
  s.emit({ type: "tool", name: use.name, status: "done" });

  if (use.name === "update_brand_brief") {
    const r = res.result as { version: number; changed: string[] };
    const r2 = res.result as { diff: BriefDiff };
    for (const [k, v] of Object.entries(r2.diff)) {
      const key = k as keyof BriefDiff;
      s.briefDiff[key] = { from: s.briefDiff[key]?.from ?? v!.from, to: v!.to };
    }
    s.emit({ type: "brief", version: r.version, changed: r.changed });
  }
  if (use.name === "quote_job" || use.name === "approve_job") {
    const job = res.result as Pick<JobView, "id">;
    if (!s.jobRefs.includes(job.id)) s.jobRefs.push(job.id);
    s.emit({ type: "job", jobId: job.id });
  }
  return ok(res.result);
}
