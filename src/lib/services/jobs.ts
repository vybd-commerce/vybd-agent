import { and, asc, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { briefFieldsSchema } from "@/lib/brief";
import { canTransition, reachedStepIndex, jobType } from "@/lib/jobs/registry";
import type { JobStatus } from "@/lib/jobs/types";
import { appUrl, devCheckoutAllowed, stripe } from "@/lib/stripe";
import type { MessageAttachments } from "@/lib/types";
import { type Ctx, ForbiddenError, InvalidStateError, NotFoundError } from "./context";
import { advanceStage, getBrand, getOwnedBrand } from "./brands";
import { latestBrief, updateBrandBrief } from "./brief";
import { postToBrand, updateMessageAttachments } from "./conversations";
import { emitBrandEvent, emitOpsEvent } from "./events";

export type Job = typeof schema.jobs.$inferSelect;
export type JobEvent = typeof schema.jobEvents.$inferSelect;
type Actor = JobEvent["actor"];

async function loadJob(jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new NotFoundError("Job not found");
  return job;
}

async function addEvent(jobId: string, kind: JobEvent["kind"], payload: Record<string, unknown>, actor: Actor, actorId?: string) {
  const [event] = await db.insert(schema.jobEvents).values({ jobId, kind, payload, actor, actorId }).returning();
  return event;
}

async function notify(job: Job) {
  await emitBrandEvent(job.brandId, { type: "job", jobId: job.id, status: job.status });
  await emitOpsEvent({ jobId: job.id, status: job.status });
}

/** Apply a status change. Guards the state machine with a compare-and-set on the old status. */
async function transition(
  jobId: string,
  to: JobStatus,
  actor: Actor,
  opts: { actorId?: string; set?: Partial<typeof schema.jobs.$inferInsert>; note?: string } = {},
) {
  const job = await loadJob(jobId);
  if (!canTransition(job.status, to)) {
    throw new InvalidStateError(`Job is ${job.status}; cannot move to ${to}`);
  }
  const [updated] = await db
    .update(schema.jobs)
    .set({ ...opts.set, status: to, updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, job.status)))
    .returning();
  if (!updated) throw new InvalidStateError("Job changed concurrently; retry");
  await addEvent(jobId, "status", { from: job.status, to, ...(opts.note && { note: opts.note }) }, actor, opts.actorId);
  await notify(updated);
  return updated;
}

// ---------- Reads ----------

export function jobView(job: Job, events: JobEvent[]) {
  const def = jobType(job.type);
  const progressSteps = events
    .filter((e) => e.kind === "progress" && e.payload.step)
   .map((e) => String(e.payload.step));
  return {
    ...job,
    title: def.title,
    deliverable: def.deliverable,
    fulfillerLabel: def.fulfillerLabel,
    steps: def.steps,
    reachedStep: reachedStepIndex(def, job.status, progressSteps),
    events,
  };
}
export type JobView = ReturnType<typeof jobView>;

export async function getJob(ctx: Ctx, jobId: string) {
  const job = await loadJob(jobId);
  await getBrand(ctx, job.brandId);
  const events = await db
    .select()
    .from(schema.jobEvents)
    .where(eq(schema.jobEvents.jobId, jobId))
    .orderBy(asc(schema.jobEvents.createdAt));
  return jobView(job, events);
}

export async function listJobs(ctx: Ctx, brandId: string) {
  await getBrand(ctx, brandId);
  const jobs = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.brandId, brandId))
    .orderBy(desc(schema.jobs.createdAt));
  if (jobs.length === 0) return [];
  const events = await db
    .select()
    .from(schema.jobEvents)
    .where(inArray(schema.jobEvents.jobId, jobs.map((j) => j.id)))
    .orderBy(asc(schema.jobEvents.createdAt));
  return jobs.map((j) => jobView(j, events.filter((e) => e.jobId === j.id)));
}

// ---------- Founder actions ----------

/** Create a quoted job. Spec fields not given are drafted from the brief. */
export async function quoteJob(ctx: Ctx, brandId: string, type: string, specInput: Record<string, unknown> = {}) {
  await getOwnedBrand(ctx, brandId);
  const def = jobType(type);
  const brief = await latestBrief(brandId);
  const drafted = def.draftSpec(brief.fields) as Record<string, unknown>;
  const spec = def.specSchema.parse({ ...drafted, ...stripEmpty(specInput) }) as Record<string, unknown>;
  const { priceCents, etaDays } = def.quote(spec);
  const [job] = await db
    .insert(schema.jobs)
    .values({ brandId, type, spec, status: "quoted", priceCents, etaDays, fulfiller: def.fulfiller })
    .returning();
  await addEvent(job.id, "status", { from: null, to: "quoted" }, "agent");
  await notify(job);
  return getJob(ctx, job.id);
}

function stripEmpty(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
  );
}

export async function updateJobSpec(ctx: Ctx, jobId: string, specInput: Record<string, unknown>) {
  const job = await loadJob(jobId);
  await getOwnedBrand(ctx, job.brandId);
  if (job.status !== "quoted" && job.status !== "draft") throw new InvalidStateError("Spec can only change before approval");
  const def = jobType(job.type);
  const spec = def.specSchema.parse({ ...job.spec, ...specInput }) as Record<string, unknown>;
  const { priceCents, etaDays } = def.quote(spec);
  await transition(jobId, "quoted", "user", { actorId: ctx.userId, set: { spec, priceCents, etaDays }, note: "Spec edited" });
  return getJob(ctx, jobId);
}

/**
 * Approve a quote. Free jobs start immediately. Paid jobs return a Stripe Checkout URL;
 * the job starts when the webhook confirms payment. Never charges silently.
 */
export async function approveJob(ctx: Ctx, jobId: string): Promise<{ job: JobView; checkoutUrl?: string }> {
  const job = await loadJob(jobId);
  const brand = await getOwnedBrand(ctx, job.brandId);
  if (job.status !== "quoted") throw new InvalidStateError(`Job is ${job.status}; only quoted jobs can be approved`);

  if (job.priceCents === 0) {
    await transition(jobId, "approved", "user", { actorId: ctx.userId });
    await startJob(jobId);
    return { job: await getJob(ctx, jobId) };
  }

  const def = jobType(job.type);
  const back = `${appUrl()}/brands/${brand.id}?job=${job.id}`;
  let checkoutUrl: string;
  if (devCheckoutAllowed()) {
    checkoutUrl = `${appUrl()}/dev/checkout/${job.id}`;
  } else {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: job.priceCents,
            product_data: { name: `${def.title} — ${brand.name}`, description: def.deliverable },
          },
        },
      ],
      metadata: { jobId: job.id, brandId: brand.id },
      payment_intent_data: { metadata: { jobId: job.id } },
      success_url: `${back}&paid=1`,
      cancel_url: back,
    });
    checkoutUrl = session.url!;
    await db.update(schema.jobs).set({ stripeCheckoutSession: session.id }).where(eq(schema.jobs.id, jobId));
  }
  await addEvent(jobId, "progress", { note: "Checkout opened", checkout: true }, "user", ctx.userId);
  return { job: await getJob(ctx, jobId), checkoutUrl };
}

/** Called by the Stripe webhook (or the dev checkout) once payment succeeds. Idempotent. */
export async function markJobPaid(jobId: string, paymentIntent: string | null) {
  const job = await loadJob(jobId);
  if (job.status !== "quoted") return job; // already processed
  await transition(jobId, "approved", "system", { set: { stripePaymentIntent: paymentIntent }, note: "Payment received" });
  return startJob(jobId);
}

async function startJob(jobId: string) {
  const job = await transition(jobId, "in_progress", "system");
  const def = jobType(job.type);
  if (def.fulfiller !== "agent") {
    // Notify ops. A real deployment would page/email; the ops console listens on the ops channel.
    console.log(`[ops] New ${def.title} job ${job.id} needs an operator: ${appUrl()}/ops/jobs/${job.id}`);
    await addEvent(jobId, "progress", { note: "Ops notified" }, "system");
  }
  return job;
}

export async function cancelJob(ctx: Ctx, jobId: string) {
  const job = await loadJob(jobId);
  await getOwnedBrand(ctx, job.brandId);
  if (!["draft", "quoted"].includes(job.status)) throw new InvalidStateError("Only unpaid jobs can be cancelled here");
  await transition(jobId, "cancelled", "user", { actorId: ctx.userId });
  return getJob(ctx, jobId);
}

export async function acceptJob(ctx: Ctx, jobId: string) {
  const job = await loadJob(jobId);
  await getOwnedBrand(ctx, job.brandId);
  await transition(jobId, "accepted", "user", { actorId: ctx.userId });
  return getJob(ctx, jobId);
}

/** Message inside the job thread. Founders and operators both post here. */
export async function postJobMessage(ctx: Ctx, jobId: string, text: string) {
  const job = await loadJob(jobId);
  const brand = await getBrand(ctx, job.brandId);
  const isOwner = brand.ownerId === ctx.userId;
  if (!isOwner && ctx.role !== "operator") throw new ForbiddenError("Not allowed");
  const body = text.trim().slice(0, 4000);
  if (!body) throw new InvalidStateError("Empty message");
  await addEvent(jobId, "message", { text: body }, isOwner ? "user" : "operator", ctx.userId);
  await notify(job);
  return getJob(ctx, jobId);
}

// ---------- Operator actions ----------

function requireOperator(ctx: Ctx) {
  if (ctx.role !== "operator") throw new ForbiddenError("Operators only");
}

export async function listOpsJobs(ctx: Ctx, filter: { status?: JobStatus[]; mine?: boolean } = {}) {
  requireOperator(ctx);
  const where = [
    filter.status?.length ? inArray(schema.jobs.status, filter.status) : undefined,
    filter.mine ? eq(schema.jobs.operatorId, ctx.userId) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({ job: schema.jobs, brandName: schema.brands.name, ownerEmail: schema.users.email })
    .from(schema.jobs)
    .innerJoin(schema.brands, eq(schema.brands.id, schema.jobs.brandId))
    .innerJoin(schema.users, eq(schema.users.id, schema.brands.ownerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.jobs.updatedAt))
    .limit(200);
  return rows.map((r) => ({ ...r.job, brandName: r.brandName, ownerEmail: r.ownerEmail, title: jobType(r.job.type).title }));
}

export async function claimJob(ctx: Ctx, jobId: string) {
  requireOperator(ctx);
  const [job] = await db
    .update(schema.jobs)
    .set({ operatorId: ctx.userId, updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), isNull(schema.jobs.operatorId)))
    .returning();
  if (!job) throw new InvalidStateError("Job already claimed");
  await addEvent(jobId, "progress", { step: "assigned", note: "Operator assigned" }, "operator", ctx.userId);
  await notify(job);
  return getJob(ctx, jobId);
}

export async function postProgress(ctx: Ctx, jobId: string, input: { step?: string; note: string }) {
  requireOperator(ctx);
  const job = await loadJob(jobId);
  if (input.step && !jobType(job.type).steps.some((s) => s.key === input.step)) {
    throw new InvalidStateError(`Unknown step ${input.step}`);
  }
  await addEvent(jobId, "progress", { ...(input.step && { step: input.step }), note: input.note }, "operator", ctx.userId);
  await db.update(schema.jobs).set({ updatedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  await notify(job);
  return getJob(ctx, jobId);
}

export async function operatorDeliver(ctx: Ctx, jobId: string, result: unknown) {
  requireOperator(ctx);
  const job = await loadJob(jobId);
  // An operator can pick up a job the agent failed on and deliver it by hand.
  if (job.status === "failed") await transition(jobId, "in_progress", "operator", { actorId: ctx.userId, note: "Operator took over" });
  await deliverJob(jobId, result, "operator", ctx.userId);
  return getJob(ctx, jobId);
}

export async function operatorFail(ctx: Ctx, jobId: string, reason: string) {
  requireOperator(ctx);
  await transition(jobId, "failed", "operator", { actorId: ctx.userId, note: reason });
  return getJob(ctx, jobId);
}

// ---------- Delivery (agents and operators) ----------

export class ResultValidationError extends Error {
  status = 422;
}

/** Validate and attach a result, then summarize in chat and attach to the Brand Brain. */
export async function deliverJob(jobId: string, rawResult: unknown, actor: Actor, actorId?: string) {
  const job = await loadJob(jobId);
  const def = jobType(job.type);
  const parsed = def.resultSchema.safeParse(rawResult);
  if (!parsed.success) throw new ResultValidationError(z.prettifyError(parsed.error));
  const result = parsed.data as Record<string, unknown>;

  const delivered = await transition(jobId, "delivered", actor, { actorId, set: { result } });
  await addEvent(jobId, "result", { summary: def.title }, actor, actorId);
  await addEvent(jobId, "progress", { step: "delivered", note: "Delivered" }, actor, actorId);

  const brief = await latestBrief(job.brandId);
  const { content, proposedEdits } = def.summarize(result, brief.fields);
  const attachments: MessageAttachments = { jobRefs: [jobId] };
  if (proposedEdits?.length) attachments.proposedEdits = proposedEdits;
  await postToBrand(job.brandId, { content, attachments });
  if (def.stageOnDelivery) await advanceStage(job.brandId, def.stageOnDelivery);
  return delivered;
}

/** Agent failure. The reason goes to ops; the founder gets a plain status and no internals. */
export async function failJob(jobId: string, reason: string) {
  const job = await transition(jobId, "failed", "agent", { note: reason });
  await postToBrand(job.brandId, {
    content: `The ${jobType(job.type).title.toLowerCase()} hit a problem on our side. A Vybd operator has been notified and will finish it by hand.`,
    attachments: { jobRefs: [jobId] },
  });
  console.log(`[ops] Job ${jobId} failed and needs an operator: ${reason}`);
  return job;
}

/** Apply a proposed brief edit from a job summary message ("Price confirmed"). */
export async function applyProposedEdit(ctx: Ctx, messageId: string, index: number) {
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg) throw new NotFoundError("Message not found");
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, msg.conversationId) });
  await getOwnedBrand(ctx, conv!.brandId);
  const edits = msg.attachments.proposedEdits ?? [];
  const edit = edits[index];
  if (!edit) throw new NotFoundError("Edit not found");
  if (edit.applied) return msg;
  const patch = briefFieldsSchema.parse(edit.patch);
  await updateBrandBrief(ctx, conv!.brandId, patch, "job");
  edits[index] = { ...edit, applied: true };
  return updateMessageAttachments(messageId, { ...msg.attachments, proposedEdits: edits });
}

// ---------- Worker ----------

/** Atomically claim the next agent job that is ready to run. */
export async function claimNextAgentJob(): Promise<Job | null> {
  const rows = await db.execute<{ id: string }>(dsql`
    update jobs set agent_claimed_at = now()
    where id = (
      select id from jobs
      where status = 'in_progress' and fulfiller in ('agent', 'hybrid') and agent_claimed_at is null
      order by created_at
      for update skip locked
      limit 1
    )
    returning id`);
  const id = rows[0]?.id;
  return id ? loadJob(id) : null;
}

export async function addAgentProgress(jobId: string, step: string, note: string) {
  const job = await loadJob(jobId);
  await addEvent(jobId, "progress", { ...(step && { step }), note }, "agent");
  await notify(job);
}
