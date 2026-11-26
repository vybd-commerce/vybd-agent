import { z } from "zod";
import { BRIEF_LABELS, briefFieldsSchema } from "@/lib/brief";
import { builder, builderEnabled, RUN_STEPS, type BuilderRun } from "@/lib/builder/client";
import { InvalidStateError } from "@/lib/services/context";
import { ensureBuilderBrand } from "@/lib/services/builder-sync";
import { PRICES } from "./prices";
import type { AgentRunHelpers, JobTypeDef } from "./types";
import { JobYield } from "./yield";

// Deep research done by the Brand Builder's runner on the canonical brief. The agent only starts the
// run, relays its progress and turns the builder's proposals into one-tap brief edits.
//
// The agent drives the run: each `advanceRun` call has the builder work for up to ADVANCE_BUDGET_S.
// On a serverless host the job yields before its invocation's deadline and the next tick resumes it
// from the saved run id, so a run of many minutes never sits inside one 300 s function.

const MAX_WAIT_MS = 45 * 60_000;
/** Longest the builder works per advance call (the builder caps it at 200 s). */
const ADVANCE_BUDGET_S = 180;
/** Smallest advance worth making (about one builder phase); with less time left the job yields instead. */
const MIN_ADVANCE_S = 90;
/** Time kept back after the last advance to fetch the report and deliver. */
const HANDBACK_MARGIN_MS = 30_000;
/** Wait before retrying when an advance made no progress (another builder worker holds the run). */
const BUSY_WAIT_MS = 20_000;

const researchStateSchema = z.object({
  builderRunId: z.string(),
  submittedAt: z.number(),
  reported: z.array(z.string()).default([]),
});
type ResearchState = z.infer<typeof researchStateSchema>;

const isTerminal = (run: BuilderRun) => run.status === "completed" || run.status === "failed" || run.status === "cancelled";

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

async function runResearch(helpers: AgentRunHelpers): Promise<ResearchResult> {
  const { brandId, progress } = helpers;
  const deadlineAt = helpers.deadlineAt ?? Infinity;
  const { actAs, builderBrandId } = await ensureBuilderBrand(brandId);

  // Resume the run an earlier invocation started; never submit a second one.
  const saved = researchStateSchema.safeParse(helpers.state ?? null);
  let state: ResearchState;
  let run: BuilderRun;
  if (saved.success) {
    state = saved.data;
    run = await builder().getRun(actAs, state.builderRunId);
  } else {
    run = await builder().submitRun(actAs, builderBrandId);
    state = { builderRunId: run.id, submittedAt: Date.now(), reported: [] };
    await helpers.saveState?.(state);
  }

  while (true) {
    const fresh = run.completedSteps.filter((s) => !state.reported.includes(s));
    for (const step of fresh) await progress(step, STEP_LABELS[step as keyof typeof STEP_LABELS] ?? step);
    if (fresh.length) {
      state = { ...state, reported: [...state.reported, ...fresh] };
      await helpers.saveState?.(state);
    }
    if (run.status === "completed") break;
    if (run.status === "failed" || run.status === "cancelled") {
      throw new Error(`Brand Builder run ${run.id} ${run.status}${run.error ? `: ${run.error}` : ""}`);
    }
    if (Date.now() > state.submittedAt + MAX_WAIT_MS) throw new Error(`Brand Builder run ${run.id} still ${run.status} after 45 minutes`);

    const budgetS = Math.min(ADVANCE_BUDGET_S, (deadlineAt - Date.now() - HANDBACK_MARGIN_MS) / 1000);
    if (budgetS < MIN_ADVANCE_S) throw new JobYield(0, "the builder run continues in the next tick");
    const before = run.completedSteps.length;
    run = await builder().advanceRun(actAs, run.id, budgetS);
    if (run.completedSteps.length === before && !isTerminal(run)) {
      // No progress: another builder worker holds the run (or a phase outlasted the budget).
      if (Number.isFinite(deadlineAt)) throw new JobYield(BUSY_WAIT_MS, "the builder run is busy");
      await new Promise((r) => setTimeout(r, Number(process.env.BUILDER_POLL_MS ?? 5000)));
      run = await builder().getRun(actAs, run.id);
    }
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
  run: (_spec, helpers) => runResearch(helpers),
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
