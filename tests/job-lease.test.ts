import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema, sql } from "@/db";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import {
  MAX_AGENT_ATTEMPTS,
  approveJob,
  claimNextAgentJob,
  failAbandonedAgentJobs,
  quoteJob,
  releaseAgentLease,
  renewAgentLease,
  saveAgentState,
  yieldAgentJob,
} from "@/lib/services/jobs";

let ctx: Ctx;

beforeAll(async () => {
  const [u] = await db.insert(schema.users).values({ email: `lease-${Date.now()}@test.dev` }).returning();
  ctx = { userId: u.id, role: "user" };
});

afterAll(async () => {
  await sql.end();
});

/** A market snapshot left for the worker (not the founder's assistant). */
async function workerJob() {
  const brand = await createBrand(ctx, {});
  const job = await quoteJob(ctx, brand.id, "market_snapshot");
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    await approveJob(ctx, job.id);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
  return job.id;
}

/** Claim everything claimable; other test files may have left jobs in the queue. */
async function claimAll() {
  const ids: string[] = [];
  for (let job = await claimNextAgentJob(); job; job = await claimNextAgentJob()) ids.push(job.id);
  return ids;
}

const row = async (id: string) => (await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) }))!;
const expireLease = (id: string) =>
  db.update(schema.jobs).set({ agentLeaseExpiresAt: dsql`now() - interval '1 second'` as unknown as Date }).where(eq(schema.jobs.id, id));

describe("agent job lease", () => {
  it("claims a job once while its worker is alive", async () => {
    const id = await workerJob();
    expect(await claimAll()).toContain(id);
    const claimed = await row(id);
    expect(claimed.agentAttempts).toBe(1);
    expect(claimed.agentLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await claimAll()).not.toContain(id);

    const before = claimed.agentLeaseExpiresAt!.getTime();
    await new Promise((r) => setTimeout(r, 20));
    await renewAgentLease(id);
    expect((await row(id)).agentLeaseExpiresAt!.getTime()).toBeGreaterThan(before);
  });

  it("resumes a job whose worker died, then sends it to ops after the last attempt", async () => {
    expect(MAX_AGENT_ATTEMPTS).toBe(2);
    const id = await workerJob();
    expect(await claimAll()).toContain(id);

    await expireLease(id); // worker died mid-run
    expect(await claimAll()).toContain(id);
    expect((await row(id)).agentAttempts).toBe(2);
    const events = await db.query.jobEvents.findMany({ where: eq(schema.jobEvents.jobId, id) });
    expect(events.some((e) => e.payload.note === "Resuming after an interrupted run")).toBe(true);

    await expireLease(id); // died again: no attempts left
    expect(await claimAll()).not.toContain(id);
    expect(await failAbandonedAgentJobs()).toBeGreaterThanOrEqual(1);
    const failed = await row(id);
    expect(failed.status).toBe("failed");
    expect(failed.agentLeaseExpiresAt).toBeNull();
  });

  it("never re-runs a job the worker released (hybrid draft handed to ops)", async () => {
    const id = await workerJob();
    expect(await claimAll()).toContain(id);
    await releaseAgentLease(id);
    expect(await claimAll()).not.toContain(id);
    await failAbandonedAgentJobs();
    expect((await row(id)).status).toBe("in_progress");
  });

  it("a yielded job waits, keeps its state, and is not counted as interrupted", async () => {
    const id = await workerJob();
    expect(await claimAll()).toContain(id);
    await saveAgentState(id, { builderRunId: "r1" });
    await yieldAgentJob(id, 60_000);
    let r = await row(id);
    expect(r.agentAttempts).toBe(0);
    expect(r.agentLeaseExpiresAt).toBeNull();
    expect(await claimAll()).not.toContain(id); // still waiting

    await db.update(schema.jobs).set({ agentWaitUntil: dsql`now() - interval '1 second'` as unknown as Date }).where(eq(schema.jobs.id, id));
    expect(await claimAll()).toContain(id);
    r = await row(id);
    expect(r.agentAttempts).toBe(1);
    expect(r.agentState).toEqual({ builderRunId: "r1" });
    const events = await db.query.jobEvents.findMany({ where: eq(schema.jobEvents.jobId, id) });
    expect(events.some((e) => e.payload.note === "Resuming after an interrupted run")).toBe(false);

    // Yields never use up attempts, however many there are.
    for (let i = 0; i < MAX_AGENT_ATTEMPTS + 1; i++) {
      await yieldAgentJob(id, 0);
      expect(await claimAll()).toContain(id);
    }
    expect((await row(id)).agentAttempts).toBe(1);
  });
});
