import { z } from "zod";
import { BRIEF_LABELS, briefFieldsSchema } from "@/lib/brief";
import { builder, builderEnabled, RUN_STEPS } from "@/lib/builder/client";
import { InvalidStateError } from "@/lib/services/context";
import { ensureBuilderBrand } from "@/lib/services/builder-sync";
import { PRICES } from "./prices";
import type { JobTypeDef } from "./types";

// Deep research done by the Brand Builder's runner on the canonical brief. The agent only starts the
// run, relays its progress and turns the builder's proposals into one-tap brief edits.

const MAX_WAIT_MS = 45 * 60_000;

const STEP_LABELS: Record<(typeof RUN_STEPS)[number], string> = {
  understand: "Brief understood",
  market_scan: "Market scanned",
  customer_insight: "Customer insight",
  opportunities: "Opportunities found",
  focus_plan: "Focus plan drafted",
  report: "Report written",
};

export const researchSpecSchema = z.object({});
export type ResearchSpec = z.infer<typeof researchSpecSchema>;

export const researchResultSchema = z.object({
  builderRunId: z.string(),
  reportMd: z.string().min(1),
  proposals: z
    .array(
      z.object({
        builderProposalId: z.string(),
        patch: briefFieldsSchema,
        rationale: z.string().default(""),
      }),
    )
    .default([]),
});
export type ResearchResult = z.infer<typeof researchResultSchema>;

async function runResearch(brandId: string, progress: (step: string, note: string) => Promise<void>): Promise<ResearchResult> {
  const { actAs, builderBrandId } = await ensureBuilderBrand(brandId);
  let run = await builder().submitRun(actAs, builderBrandId);
  const reported = new Set<string>();
  const deadline = Date.now() + MAX_WAIT_MS;
  while (true) {
    for (const step of run.completedSteps) {
      if (reported.has(step)) continue;
      reported.add(step);
      await progress(step, STEP_LABELS[step as keyof typeof STEP_LABELS] ?? step);
    }
    if (run.status === "completed") break;
    if (run.status === "failed" || run.status === "cancelled") {
      throw new Error(`Brand Builder run ${run.id} ${run.status}${run.error ? `: ${run.error}` : ""}`);
    }
    if (Date.now() > deadline) throw new Error(`Brand Builder run ${run.id} still ${run.status} after 45 minutes`);
    await new Promise((r) => setTimeout(r, Number(process.env.BUILDER_POLL_MS ?? 5000)));
    run = await builder().getRun(actAs, run.id);
  }
  const [reportMd, proposals] = await Promise.all([
    builder().getReport(actAs, run.id),
    builder().listProposals(actAs, builderBrandId, run.id),
  ]);
  return {
    builderRunId: run.id,
    reportMd,
    proposals: proposals.map((p) => ({ builderProposalId: p.id, patch: { [p.field]: p.value }, rationale: p.rationale })),
  };
}

export const brandResearch: JobTypeDef<ResearchSpec, ResearchResult> = {
  type: "brand_research",
  title: "Brand research",
  deliverable: "A research report on your market, customer and best opportunities, with suggested brief changes",
  fulfiller: "agent",
  fulfillerLabel: "Vybd research agents",
  specSchema: researchSpecSchema as z.ZodType<ResearchSpec>,
  resultSchema: researchResultSchema as z.ZodType<ResearchResult>,
  draftSpec: () => ({}),
  quote: () => PRICES.brand_research,
  // The builder only runs on a complete brief; say what's missing before anyone approves a quote.
  precheck: async (brandId) => {
    if (!builderEnabled()) throw new InvalidStateError("Brand research isn't available yet.");
    const { actAs, builderBrandId } = await ensureBuilderBrand(brandId);
    const { eligible, missing } = await builder().getScore(actAs, builderBrandId);
    if (!eligible) {
      throw new InvalidStateError(`Brand research needs a fuller brief. Missing: ${missing.map((k) => BRIEF_LABELS[k]).join(", ")}.`);
    }
  },
  steps: RUN_STEPS.map((key) => ({ key, label: STEP_LABELS[key] })),
  statusStep: { approved: "understand", in_progress: "understand", delivered: "report", accepted: "report" },
  deliveryForm: {
    listKey: "proposals",
    listLabel: "Suggested brief changes",
    minItems: 0,
    maxItems: 0,
    itemFields: [],
    extraFields: [{ key: "reportMd", label: "Report (Markdown)", type: "textarea" }],
  },
  run: (_spec, helpers) => runResearch(helpers.brandId, helpers.progress),
  summarize: (result) => {
    const n = result.proposals.length;
    return {
      content: `Your brand research is in. The full report is on the job.${n ? ` It suggests ${n} brief change${n === 1 ? "" : "s"}; tap one to apply it.` : ""}`,
      proposedEdits: result.proposals.map((p) => ({
        label: `Update ${Object.keys(p.patch)
          .map((k) => BRIEF_LABELS[k as keyof typeof BRIEF_LABELS].toLowerCase())
          .join(", ")}`,
        patch: p.patch,
        builderProposalId: p.builderProposalId,
      })),
    };
  },
};
