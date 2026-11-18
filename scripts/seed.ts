/**
 * Seed realistic data for local development and staging: `pnpm db:seed`.
 *
 * Creates three users (owner, member, operator), one brand with a usable brief that the member joined
 * through an invite, and one job in each status. Jobs move through the real services, so their events,
 * chat summaries and brand stage match what the app produces. Only `draft` and `approved` are written
 * directly: no service leaves a job in those states (quotes start at `quoted`, and approval starts the job).
 *
 * Safe to re-run: users are upserted by email and the seed brand is deleted and rebuilt each time.
 * Refuses to run against production.
 */
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { DEMO_SNAPSHOT } from "@/lib/demo/script";
import type { JobStatus } from "@/lib/jobs/types";
import { createBrand } from "@/lib/services/brands";
import { updateBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { acceptInvite, getOrCreateInvite } from "@/lib/services/invites";
import {
  acceptJob,
  approveJob,
  cancelJob,
  claimJob,
  deliverJob,
  failJob,
  markJobPaid,
  operatorDeliver,
  postJobMessage,
  postProgress,
  quoteJob,
} from "@/lib/services/jobs";

export const SEED_USERS = {
  owner: { email: "owner@seed.vybd.test", name: "Olivia Owner", role: "user" },
  member: { email: "member@seed.vybd.test", name: "Max Member", role: "user" },
  operator: { email: "operator@seed.vybd.test", name: "Opal Operator", role: "operator" },
} as const;

export const SEED_BRAND_NAME = "Rootwell (seed)";

const BRIEF = {
  oneLiner: "A refillable scalp oil ritual for women in their 40s noticing thinner hair.",
  customer: "Women 38–50 who noticed thinning after pregnancy or perimenopause and dislike clinical-looking products.",
  problem: "Hair-growth products feel medical and embarrassing; nobody wants them on the bathroom shelf.",
  alternative: "Minoxidil, supplements like Nutrafol, or doing nothing.",
  positioning: "The calm, good-looking scalp ritual, not a treatment: glass dropper, botanical oil, refills every six weeks.",
  competitors: ["Vegamour", "Nutrafol", "Act+Acre"],
  price: "$38 per starter kit, $24 refill",
  channels: ["Shopify store", "Instagram"],
  goals: "First 100 orders by March.",
  nameDirections: ["Rootwell", "Crown & Calm", "Still Root"],
  openQuestions: ["Fragrance-free or a light scent?"],
};

const SUPPLIERS = {
  suppliers: [
    { name: "Botanica Labs", location: "New Jersey, US", contact: "sales@botanica.example", moq: "500 units", unitPrice: "$4.80", leadTime: "4 weeks", sampleCost: "$60", notes: "GMP certified, private label." },
    { name: "Green Leaf Cosmetics", location: "Guangzhou, CN", contact: "amy@greenleaf.example", moq: "1,000 units", unitPrice: "$2.10", leadTime: "6 weeks", sampleCost: "$35", notes: "Fast samples; labels need US review." },
    { name: "Northwind Formulators", location: "Ontario, CA", contact: "+1 555 0100", moq: "300 units", unitPrice: "$5.60", leadTime: "3 weeks", sampleCost: "$80", notes: "Lowest MOQ; glass droppers in stock." },
  ],
  summary: "Northwind for the first 300-unit run; Botanica once volume passes 500.",
};

/** Refuse anything that looks like production. Staging is seeded from a laptop pointed at its database. */
export function assertNotProduction(env: { NODE_ENV?: string; RAILWAY_ENVIRONMENT_NAME?: string } = process.env) {
  if (env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT_NAME === "production") {
    throw new Error("Refusing to seed: this looks like production (NODE_ENV or RAILWAY_ENVIRONMENT_NAME is 'production').");
  }
}

async function upsertUser(u: (typeof SEED_USERS)[keyof typeof SEED_USERS]): Promise<Ctx> {
  const [row] = await db
    .insert(schema.users)
    .values({ email: u.email, name: u.name, role: u.role, emailVerified: new Date() })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: u.name, role: u.role } })
    .returning();
  return { userId: row.id, role: row.role };
}

/** Write a job in a state no service leaves it in, with the status event the app would have logged. */
async function insertJobAt(owner: Ctx, brandId: string, status: JobStatus, from: JobStatus | null) {
  const quoted = await quoteSuppliers(owner, brandId);
  await db.update(schema.jobs).set({ status, updatedAt: new Date() }).where(eq(schema.jobs.id, quoted.id));
  if (status === "draft") {
    // Drafts exist before a quote, so drop the quote event too.
    await db.delete(schema.jobEvents).where(eq(schema.jobEvents.jobId, quoted.id));
  }
  await db.insert(schema.jobEvents).values({ jobId: quoted.id, kind: "status", payload: { from, to: status }, actor: "system" });
  return quoted.id;
}

function quoteSuppliers(owner: Ctx, brandId: string) {
  return quoteJob(owner, brandId, "find_suppliers", { products: ["Scalp oil 50ml", "Refill pouch 100ml"], moq: "500 units", targetUnitCost: "$6" });
}

/** Agent jobs: mark claimed before approval so a running worker never picks up seed work. */
async function quoteSnapshot(owner: Ctx, brandId: string) {
  const job = await quoteJob(owner, brandId, "market_snapshot");
  await db.update(schema.jobs).set({ agentClaimedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  return job;
}

export async function seed() {
  assertNotProduction();
  // Seed data is real data, not the scripted demo: never run agent jobs in this process.
  delete process.env.VYBD_DEMO;

  const ownerCtx = await upsertUser(SEED_USERS.owner);
  const member = await upsertUser(SEED_USERS.member);
  const operator = await upsertUser(SEED_USERS.operator);

  // Rebuild the seed brand from scratch. Jobs, briefs, members and messages cascade.
  await db
    .delete(schema.brands)
    .where(and(eq(schema.brands.ownerId, ownerCtx.userId), eq(schema.brands.name, SEED_BRAND_NAME)));

  const brand = await createBrand(ownerCtx, { name: SEED_BRAND_NAME });
  await updateBrandBrief(ownerCtx, brand.id, BRIEF, "chat");
  const invite = await getOrCreateInvite(ownerCtx, brand.id);
  await acceptInvite(member, invite.token);

  const jobs: Partial<Record<JobStatus, string>> = {};

  jobs.draft = await insertJobAt(ownerCtx, brand.id, "draft", null);

  jobs.quoted = (await quoteJob(ownerCtx, brand.id, "market_snapshot", { notes: "Focus on DTC scalp care brands." })).id;

  jobs.approved = await insertJobAt(ownerCtx, brand.id, "approved", "quoted");

  // Paid operator job, claimed and part-way through vetting.
  const working = await quoteSuppliers(ownerCtx, brand.id);
  await markJobPaid(working.id, "pi_seed_in_progress");
  await claimJob(operator, working.id);
  await postProgress(operator, working.id, { step: "vetting", note: "Two quotes in, waiting on a third." });
  await postJobMessage(ownerCtx, working.id, "Glass droppers are a must-have, please.");
  jobs.in_progress = working.id;

  // Free agent job, delivered with a snapshot; leaves proposed brief edits in the chat.
  const snapshot = await quoteSnapshot(ownerCtx, brand.id);
  await approveJob(ownerCtx, snapshot.id);
  await deliverJob(snapshot.id, { ...DEMO_SNAPSHOT, priceBand: { ...DEMO_SNAPSHOT.priceBand, userPrice: 38 } }, "agent");
  jobs.delivered = snapshot.id;

  // Paid operator job, delivered by hand and accepted by the owner.
  const sourced = await quoteSuppliers(ownerCtx, brand.id);
  await markJobPaid(sourced.id, "pi_seed_accepted");
  await claimJob(operator, sourced.id);
  await operatorDeliver(operator, sourced.id, SUPPLIERS);
  await acceptJob(ownerCtx, sourced.id);
  jobs.accepted = sourced.id;

  const dropped = await quoteSuppliers(ownerCtx, brand.id);
  await cancelJob(ownerCtx, dropped.id);
  jobs.cancelled = dropped.id;

  // Agent job that failed; it sits in the ops queue for an operator to finish by hand.
  const broken = await quoteSnapshot(ownerCtx, brand.id);
  await approveJob(ownerCtx, broken.id);
  await failJob(broken.id, "Seed: research agent timed out after 12 turns");
  jobs.failed = broken.id;

  return { brandId: brand.id, users: { owner: ownerCtx.userId, member: member.userId, operator: operator.userId }, jobs };
}

async function main() {
  try {
    const result = await seed();
    const app = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    console.log(`Seeded ${SEED_BRAND_NAME}: ${app}/brands/${result.brandId}`);
    console.log(`Sign in as ${Object.values(SEED_USERS).map((u) => u.email).join(", ")} (magic link prints in the dev log).`);
    for (const [status, id] of Object.entries(result.jobs)) console.log(`  ${status.padEnd(12)} ${id}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
