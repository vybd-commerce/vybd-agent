import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema, sql } from "@/db";
import { DEMO_SNAPSHOT } from "@/lib/demo/script";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { approveJob, claimNextAgentJob, getJob, quoteJob } from "@/lib/services/jobs";
import { runTool } from "@/lib/tools";

let ctx: Ctx;
let other: Ctx;

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const [a, b] = await db
    .insert(schema.users)
    .values([{ email: `host-a-${Date.now()}@test.dev` }, { email: `host-b-${Date.now()}@test.dev` }])
    .returning();
  ctx = { userId: a.id, role: "user" };
  other = { userId: b.id, role: "user" };
});

afterAll(async () => {
  await sql.end();
});

describe("market snapshot on the founder's assistant", () => {
  it("hands the research to the MCP client and delivers what it submits", async () => {
    const brand = await createBrand(ctx, { name: "Rootwell" });
    const quoted = await quoteJob(ctx, brand.id, "market_snapshot");
    const approved = await runTool("approve_job", { jobId: quoted.id }, { ctx, surface: "mcp" });
    expect(approved.ok).toBe(true);
    const task = (approved as { result: { researchTask?: { instructions: string; resultSchema: object } } }).result.researchTask;
    expect(task?.instructions).toContain("submit_job_result");
    expect(task?.resultSchema).toBeTypeOf("object");

    // The worker must not pick it up.
    const claimed = await claimNextAgentJob();
    expect(claimed?.id).not.toBe(quoted.id);

    // Web surface: no research task, and no submit tool.
    const web = await runTool("get_job", { jobId: quoted.id }, { ctx, surface: "web" });
    expect((web as { result: Record<string, unknown> }).result.researchTask).toBeUndefined();
    expect((await runTool("submit_job_result", { jobId: quoted.id, result: {} }, { ctx, surface: "web" })).ok).toBe(false);

    // Strangers can't deliver it; a bad result comes back as a fixable error.
    expect((await runTool("submit_job_result", { jobId: quoted.id, result: DEMO_SNAPSHOT }, { ctx: other, surface: "mcp" })).ok).toBe(false);
    const bad = await runTool("submit_job_result", { jobId: quoted.id, result: { competitors: [] } }, { ctx, surface: "mcp" });
    expect(bad.ok).toBe(false);

    const good = await runTool("submit_job_result", { jobId: quoted.id, result: DEMO_SNAPSHOT }, { ctx, surface: "mcp" });
    expect(good.ok).toBe(true);
    expect((await getJob(ctx, quoted.id)).status).toBe("delivered");

    // Only once.
    expect((await runTool("submit_job_result", { jobId: quoted.id, result: DEMO_SNAPSHOT }, { ctx, surface: "mcp" })).ok).toBe(false);
  });

  it("leaves jobs without a research task to the worker", async () => {
    const brand = await createBrand(ctx, {});
    const job = await quoteJob(ctx, brand.id, "market_snapshot");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    try {
      const { job: started } = await approveJob(ctx, job.id);
      expect(started.awaitingHost).toBe(false);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
