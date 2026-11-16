import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, FALLBACK_PARAMS, MODEL } from "@/lib/anthropic";
import { BRIEF_FIELDS, formatValue, parsePrice } from "@/lib/brief";
import { DEMO_SNAPSHOT, demoMode } from "@/lib/demo/script";
import { PRICES } from "./prices";
import type { AgentRunHelpers, JobTypeDef, ResearchTask } from "./types";

export const snapshotSpecSchema = z.object({
  market: z.string().default("US online").describe("Target market. Default 'US online'."),
  oneLiner: z.string().default(""),
  customer: z.string().default(""),
  positioning: z.string().default(""),
  price: z.string().default("").describe("The founder's intended retail price."),
  notes: z.string().default("").describe("Anything else the researcher should know."),
});
export type SnapshotSpec = z.infer<typeof snapshotSpecSchema>;

const competitorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  kitPrice: z.string().min(1).describe("Price of their comparable kit/product, e.g. '$42'."),
  productCount: z.coerce.number().int().nonnegative().describe("Approximate number of products they sell."),
  angle: z.string().min(1).describe("Their positioning in a few words."),
  sourceUrl: z.string().url().describe("Page the price and details came from."),
});

const proposedEditSchema = z.object({
  label: z.string().describe("Short chip label, e.g. 'Price confirmed'."),
  patch: z.record(z.string(), z.unknown()).describe("Brief fields to change."),
});

export const snapshotResultSchema = z.object({
  competitors: z.array(competitorSchema).min(5).max(10),
  priceBand: z.object({
    low: z.coerce.number().nonnegative(),
    high: z.coerce.number().nonnegative(),
    userPrice: z.coerce.number().nonnegative().nullable().optional(),
    currency: z.string().default("USD"),
  }),
  openLane: z.string().min(1).describe("One sentence: the gap this brand can own."),
  proposedEdits: z.array(proposedEditSchema).max(4).default([]),
});
export type SnapshotResult = z.infer<typeof snapshotResultSchema>;

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_snapshot",
  description:
    "Submit the finished market snapshot. Call exactly once, after researching. Every competitor needs a real sourceUrl you visited or saw in search results.",
  input_schema: z.toJSONSchema(snapshotResultSchema, { target: "draft-7", io: "input" }) as Anthropic.Beta.BetaTool.InputSchema,
};

const RESEARCH_SYSTEM = `You are Vybd's market research agent. You produce a market snapshot for a founder's product idea.

Research with web search. Find 5 to 10 real, currently operating direct competitors selling to the target market. For each, capture the price of their closest comparable product, roughly how many products they sell, their angle, and the URL you got it from. Only include facts you found; never invent a brand or URL.

Then build a price band (low and high of comparable products, numbers in USD) and mark the founder's price if they gave one. Write the open lane as one plain sentence: the position nobody owns that this founder could.

Propose up to 3 brief edits the evidence supports, e.g. {"label":"Price confirmed","patch":{"price":"$38 per kit"}} or a sharper positioning. Brief field keys: ${BRIEF_FIELDS.join(", ")}.

When done, call submit_snapshot once with the full result.`;

function briefPrompt(spec: SnapshotSpec) {
  return [
    `Target market: ${spec.market}`,
    `One-liner: ${spec.oneLiner || "(not given)"}`,
    `Customer: ${spec.customer || "(not given)"}`,
    `Positioning: ${spec.positioning || "(not given)"}`,
    `Founder's price: ${spec.price || "(not given)"}`,
    spec.notes && `Notes: ${spec.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runSnapshot(spec: SnapshotSpec, helpers: { progress: (step: string, note: string) => Promise<void> }) {
  const client = anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Build a market snapshot for this brief.\n\n${briefPrompt(spec)}` },
  ];
  let searches = 0;
  await helpers.progress("", "Searching for competitors");

  for (let turn = 0; turn < 12; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      ...FALLBACK_PARAMS,
      output_config: { effort: "medium" },
      system: RESEARCH_SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 15 }, SUBMIT_TOOL],
      messages,
    });
    const message = await stream.finalMessage();

    const newSearches = message.content.filter((b) => b.type === "server_tool_use").length;
    if (newSearches > 0) {
      searches += newSearches;
      await helpers.progress("", `Ran ${searches} searches`);
    }

    if (message.stop_reason === "refusal") throw new Error("The research agent declined this request.");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const submit = message.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "submit_snapshot",
    );
    if (!submit) {
      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: "Finish by calling submit_snapshot with the full result." });
      continue;
    }
    if (message.stop_reason === "max_tokens") throw new Error("Snapshot output was truncated.");

    const parsed = snapshotResultSchema.safeParse(submit.input);
    if (parsed.success) {
      await helpers.progress("research", `${parsed.data.competitors.length} competitors found`);
      await helpers.progress("pricing", "Price band and open lane drafted");
      return parsed.data;
    }
    messages.push({ role: "assistant", content: message.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: submit.id,
          is_error: true,
          content: `Invalid snapshot: ${z.prettifyError(parsed.error)}. Fix and call submit_snapshot again.`,
        },
      ],
    });
  }
  throw new Error("Research agent did not finish the snapshot.");
}

/** Demo mode: canned competitors after a short, visible "research" pause. */
async function demoSnapshot(spec: SnapshotSpec, helpers: AgentRunHelpers): Promise<SnapshotResult> {
  const pause = () => new Promise((r) => setTimeout(r, 2500));
  await helpers.progress("research", "Searching competitors");
  await pause();
  await helpers.progress("pricing", "Building the price band");
  await pause();
  return snapshotResultSchema.parse({ ...DEMO_SNAPSHOT, priceBand: { ...DEMO_SNAPSHOT.priceBand, userPrice: parsePrice(spec.price) } });
}

/** Host-run version: the founder's assistant does the searching with its own tools. */
function researchTask(spec: SnapshotSpec): ResearchTask {
  return {
    instructions: RESEARCH_SYSTEM.replace(
      "When done, call submit_snapshot once with the full result.",
      "When done, call submit_job_result once with this job's jobId and the full result as `result`.",
    ),
    brief: briefPrompt(spec),
    resultSchema: SUBMIT_TOOL.input_schema as Record<string, unknown>,
  };
}

export const marketSnapshot: JobTypeDef<SnapshotSpec, SnapshotResult> = {
  type: "market_snapshot",
  title: "Market snapshot",
  deliverable: "5–10 competitors with prices and sources, a price band, and your open lane",
  fulfiller: "agent",
  fulfillerLabel: "Research agent",
  specSchema: snapshotSpecSchema as z.ZodType<SnapshotSpec>,
  resultSchema: snapshotResultSchema as z.ZodType<SnapshotResult>,
  draftSpec: (brief) =>
    snapshotSpecSchema.parse({
      market: "US online",
      oneLiner: brief.oneLiner ?? "",
      customer: brief.customer ?? "",
      positioning: brief.positioning ?? "",
      price: brief.price ?? "",
      notes: [brief.problem && `Problem: ${brief.problem}`, brief.channels?.length && `Channels: ${formatValue(brief.channels)}`]
        .filter(Boolean)
        .join(". "),
    }),
  quote: () => PRICES.market_snapshot,
  researchTask,
  steps: [
    { key: "spec", label: "Brief read" },
    { key: "research", label: "Competitors researched" },
    { key: "pricing", label: "Price band and open lane" },
    { key: "delivered", label: "Snapshot delivered" },
  ],
  statusStep: { approved: "spec", in_progress: "spec", delivered: "delivered", accepted: "delivered" },
  deliveryForm: {
    listKey: "competitors",
    listLabel: "Competitors",
    minItems: 5,
    maxItems: 10,
    itemFields: [
      { key: "name", label: "Name" },
      { key: "url", label: "Link", type: "url" },
      { key: "kitPrice", label: "Kit price" },
      { key: "productCount", label: "# products", type: "number" },
      { key: "angle", label: "Angle" },
      { key: "sourceUrl", label: "Source", type: "url" },
    ],
    extraFields: [
      { key: "priceBand.low", label: "Price band low (USD)", type: "number" },
      { key: "priceBand.high", label: "Price band high (USD)", type: "number" },
      { key: "priceBand.userPrice", label: "Founder's price (USD)", type: "number" },
      { key: "openLane", label: "Open lane", type: "textarea" },
    ],
  },
  run: (spec, helpers) => (demoMode() ? demoSnapshot(spec, helpers) : runSnapshot(spec, helpers)),
  summarize: (result, brief) => {
    const band = `$${result.priceBand.low}–$${result.priceBand.high}`;
    const userPrice = result.priceBand.userPrice ?? parsePrice(brief.price);
    const where =
      userPrice == null
        ? ""
        : userPrice < result.priceBand.low
          ? ` Your $${userPrice} sits below the band.`
          : userPrice > result.priceBand.high
            ? ` Your $${userPrice} sits above the band.`
            : ` Your $${userPrice} sits inside it.`;
    return {
      content: `Your market snapshot is in. I found ${result.competitors.length} competitors priced ${band}.${where}\n\nOpen lane: ${result.openLane}`,
      proposedEdits: result.proposedEdits.map((e) => ({ label: e.label, patch: e.patch })),
    };
  },
  stageOnDelivery: "validate",
};
