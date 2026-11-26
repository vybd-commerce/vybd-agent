import { z } from "zod";
import { appUrl } from "@/lib/stripe";
import { BRIEF_FIELDS, briefFieldsSchema } from "@/lib/brief";
import { JOB_TYPE_KEYS, jobType } from "@/lib/jobs/registry";
import { createBrand, listBrands } from "@/lib/services/brands";
import { getBrandBrief, updateBrandBrief, type BriefSource } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { createSharePage, getFeedback } from "@/lib/services/feedback";
import { getOrCreateInvite } from "@/lib/services/invites";
import { approveJob, getJob, listJobs, quoteJob, submitHostResult, type JobView } from "@/lib/services/jobs";
import { addLaneTask, claimLane, listLanes, releaseLane, setLaneTaskDone } from "@/lib/services/lanes";

/**
 * The tool table the MCP server exposes to Claude, ChatGPT or any agent. Vybd has no chat of its own:
 * the founder's assistant is the only caller. `surface` stays so a second surface can be added later.
 */
export type ToolSurface = "mcp";
export type ToolContext = { ctx: Ctx; surface: ToolSurface };

type ToolDef<S extends z.ZodObject, R> = {
  name: string;
  description: string;
  input: S;
  /** Tools that act on one brand (they take brandId). */
  brandScoped?: boolean;
  /** Limit a tool to some surfaces. Default: all. */
  surfaces?: ToolSurface[];
  /** Changes state. MCP calls to these post an activity entry to the brand thread. */
  writes?: boolean;
  handler: (args: z.infer<S>, tc: ToolContext) => Promise<R>;
  headline?: (result: R) => string;
};

function tool<S extends z.ZodObject, R>(def: ToolDef<S, R>) {
  return def;
}

const brandId = z.string().uuid().describe("The brand's id (from list_brands or create_brand).");
const laneId = z.string().uuid().describe("The lane's id from list_lanes.");
const jobTypeEnum = z.enum(JOB_TYPE_KEYS as [string, ...string[]]);

function oneLine(title: string) {
  return title.replace(/\s+/g, " ").trim();
}

function sourceFor(surface: ToolSurface): BriefSource {
  return surface;
}

/** Strip internals the model doesn't need (events can be long). */
function summarizeJob(job: JobView, surface: ToolSurface) {
  const def = jobType(job.type);
  const task = surface === "mcp" && job.awaitingHost && def.researchTask ? def.researchTask(job.spec as never) : null;
  return {
    id: job.id,
    brandId: job.brandId,
    type: job.type,
    title: job.title,
    status: job.status,
    spec: job.spec,
    price: job.priceCents === 0 ? "Free" : `$${(job.priceCents / 100).toFixed(2)}`,
    etaDays: job.etaDays,
    fulfiller: job.fulfillerLabel,
    deliverable: job.deliverable,
    progress: job.steps.map((s, i) => ({ step: s.label, done: i <= job.reachedStep })),
    messages: job.events
      .filter((e) => e.kind === "message")
      .slice(-5)
      .map((e) => ({ from: e.actor, text: e.payload.text })),
    result: job.result,
    ...(task && {
      researchTask: {
        todo: `This job runs on you. Do the research below with your own web search tools, then call submit_job_result with jobId "${job.id}" and the result. Tell the founder you're on it first; it takes a few minutes.`,
        ...task,
      },
    }),
  };
}

export const TOOLS = [
  tool({
    name: "list_brands",
    description: "List the signed-in user's brands with their stage. Each brand is a workspace for one idea.",
    input: z.object({}),
    handler: async (_args, { ctx }) =>
      (await listBrands(ctx)).map((b) => ({ id: b.id, name: b.name, stage: b.stage, createdAt: b.createdAt })),
  }),
  tool({
    name: "create_brand",
    writes: true,
    description:
      "Create a new brand workspace for an idea. Use a working name if the founder has none yet; it can change later.",
    input: z.object({ name: z.string().max(80).optional().describe("Working name for the brand.") }),
    handler: async (args, { ctx }) => {
      const brand = await createBrand(ctx, args);
      return { id: brand.id, name: brand.name, stage: brand.stage };
    },
  }),
  tool({
    name: "get_brand_brief",
    description:
      "Get the brand's current Brand Brief: fields, version, which fields are pending, and whether it is usable (has one-liner, customer and positioning).",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async (args, { ctx }) => getBrandBrief(ctx, args.brandId),
  }),
  tool({
    name: "update_brand_brief",
    writes: true,
    description: `Patch Brand Brief fields as soon as the founder gives you information. Only include fields that changed; send the complete new value for a field (arrays replace). Writes a new brief version. Fields: ${BRIEF_FIELDS.join(", ")}. Use 'asking' to mark which fields your next question is about.`,
    input: z.object({
      brandId,
      fields: briefFieldsSchema.describe("Fields to set. Omit fields you are not changing."),
      asking: z
        .array(z.enum(BRIEF_FIELDS))
        .optional()
        .describe("Fields your next question asks about. Shown as 'Asking now…' in the brief panel."),
    }),
    brandScoped: true,
    handler: async (args, { ctx, surface }) => {
      const res = await updateBrandBrief(ctx, args.brandId, args.fields, sourceFor(surface), {
        pending: args.asking,
      });
      return { version: res.version, changed: Object.keys(res.diff), diff: res.diff, usable: res.usable, fields: res.fields };
    },
  }),
  tool({
    name: "quote_job",
    writes: true,
    description: `Quote a unit of work for the brand. Creates a quoted job with price, ETA and who fulfils it; nothing is charged until the founder approves. Types: market_snapshot (${jobType("market_snapshot").deliverable}), find_suppliers (${jobType("find_suppliers").deliverable}), brand_research (${jobType("brand_research").deliverable}). Fill the spec from the brief; anything omitted is drafted from the brief.`,
    input: z.object({
      brandId,
      type: jobTypeEnum,
      spec: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "market_snapshot: {market, notes}. find_suppliers: {products[], materials, moq, targetUnitCost, regions[], mustHaves[], notes}. brand_research: {}.",
        ),
    }),
    brandScoped: true,
    handler: async (args, { ctx, surface }) => summarizeJob(await quoteJob(ctx, args.brandId, args.type, args.spec ?? {}), surface),
  }),
  tool({
    name: "approve_job",
    writes: true,
    description:
      "Approve a quoted job on the founder's explicit instruction. Free jobs start immediately. Paid jobs return a checkout link the founder must open to pay; never claim payment happened.",
    input: z.object({ jobId: z.string().uuid() }),
    handler: async (args, { ctx, surface }) => {
      const { job, checkoutUrl } = await approveJob(ctx, args.jobId);
      return { ...summarizeJob(job, surface), checkoutUrl };
    },
  }),
  tool({
    name: "get_job",
    description: "Get a job's status, progress steps, recent messages and result.",
    input: z.object({ jobId: z.string().uuid() }),
    handler: async (args, { ctx, surface }) => summarizeJob(await getJob(ctx, args.jobId), surface),
  }),
  tool({
    name: "submit_job_result",
    writes: true,
    description:
      "Deliver a job that runs on you (approve_job or get_job returned researchTask). Pass the full result matching researchTask.resultSchema. If it's rejected, fix what the error names and submit again.",
    input: z.object({
      jobId: z.string().uuid(),
      result: z.record(z.string(), z.unknown()).describe("The finished result, matching researchTask.resultSchema."),
    }),
    surfaces: ["mcp"],
    handler: async (args, { ctx }) => {
      const job = await submitHostResult(ctx, args.jobId, args.result);
      return { ...summarizeJob(job, "mcp"), delivered: true, appUrl: `${appUrl()}/brands/${job.brandId}?job=${job.id}` };
    },
  }),
  tool({
    name: "list_jobs",
    description: "List the brand's jobs with status and progress.",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async (args, { ctx, surface }) =>
      (await listJobs(ctx, args.brandId)).map((j) => ({
        ...summarizeJob(j, surface),
        researchTask: undefined,
        runsOnYou: surface === "mcp" && j.awaitingHost ? "Call get_job for the research task." : undefined,
        result: undefined,
        messages: undefined,
        hasResult: Boolean(j.result),
      })),
  }),
  tool({
    name: "create_share_page",
    writes: true,
    description:
      "Publish the brief as a public page that asks 'would you buy this?', the price people would pay, and an email for launch. Returns the URL to share.",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async (args, { ctx }) => createSharePage(ctx, args.brandId),
  }),
  tool({
    name: "invite_member",
    description:
      "Get the brand's invite link so friends can join and build it together. The link works for anyone, lasts 7 days, and the owner can reset it. Returns the URL to share.",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async (args, { ctx }) => getOrCreateInvite(ctx, args.brandId),
  }),
  tool({
    name: "list_lanes",
    description: "List the brand's lanes with their current owners and task checklists. Call this first to get lane and task IDs before making changes.",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async ({ brandId }, { ctx }) => listLanes(ctx, brandId),
    headline: (lanes) => {
      if (!lanes.length) return "No lanes yet.";
      const claimed = lanes.filter((lane) => lane.ownerId !== null).length;
      return `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"}, ${claimed} claimed.`;
    },
  }),
  tool({
    name: "claim_lane",
    writes: true,
    description: "Claim an unassigned lane for the signed-in brand teammate.",
    input: z.object({ brandId, laneId }),
    brandScoped: true,
    handler: async ({ brandId, laneId }, { ctx }) => claimLane(ctx, laneId, brandId),
    headline: (lane) => `You own the ${oneLine(lane.title)} lane.`,
  }),
  tool({
    name: "release_lane",
    writes: true,
    description: "Make a lane unassigned. The lane owner or brand owner can release it.",
    input: z.object({ brandId, laneId }),
    brandScoped: true,
    handler: async ({ brandId, laneId }, { ctx }) => releaseLane(ctx, laneId, brandId),
    headline: (lane) => `The ${oneLine(lane.title)} lane is unassigned.`,
  }),
  tool({
    name: "add_task",
    writes: true,
    description: "Append a task to a lane's checklist. Any brand teammate can add a task.",
    input: z.object({ brandId, laneId, title: z.string().trim().min(1).max(200) }),
    brandScoped: true,
    handler: async ({ brandId, laneId, title }, { ctx }) => addLaneTask(ctx, laneId, title, brandId),
    headline: (task) => `Added “${oneLine(task.title)}”.`,
  }),
  tool({
    name: "update_task",
    writes: true,
    description: "Mark a checklist task complete or incomplete. Only the lane owner can do this.",
    input: z.object({
      brandId,
      taskId: z.string().uuid().describe("The task's id from list_lanes or add_task."),
      done: z.boolean().describe("True to mark complete, false to mark incomplete."),
    }),
    brandScoped: true,
    handler: async ({ brandId, taskId, done }, { ctx }) => setLaneTaskDone(ctx, taskId, done, brandId),
    headline: (task) => `Marked “${oneLine(task.title)}” ${task.done ? "complete" : "incomplete"}.`,
  }),
  tool({
    name: "get_feedback",
    description: "Aggregated responses from the brand's share page: would-buy counts, price answers and comments.",
    input: z.object({ brandId }),
    brandScoped: true,
    handler: async (args, { ctx }) => getFeedback(ctx, args.brandId),
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export function findTool(name: string, surface?: ToolSurface) {
  const def = TOOLS.find((t) => t.name === name);
  if (!def || (surface && "surfaces" in def && def.surfaces && !(def.surfaces as ToolSurface[]).includes(surface))) return undefined;
  return def;
}

export function toolsFor(surface: ToolSurface) {
  return TOOLS.filter((t) => !("surfaces" in t) || !t.surfaces || (t.surfaces as ToolSurface[]).includes(surface));
}

/** Validate input and run a tool. Errors come back as { error } so the model can recover. */
export async function runTool(name: string, rawInput: unknown, tc: ToolContext) {
  const def = findTool(name, tc.surface);
  if (!def) return { ok: false as const, error: `Unknown tool ${name}` };
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false as const, error: `Invalid input: ${z.prettifyError(parsed.error)}` };
  try {
    // The selected definition pairs its input schema, handler, and result formatter.
    const { handler, headline } = def as ToolDef<z.ZodObject, unknown>;
    const result = await handler(parsed.data, tc);
    return { ok: true as const, result, ...(headline && { headline: headline(result) }) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export function jsonSchemaFor(input: z.ZodObject) {
  return z.toJSONSchema(input, { target: "draft-7", io: "input" }) as Record<string, unknown>;
}
