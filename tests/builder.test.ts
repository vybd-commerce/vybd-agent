import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { builder, fromSections, resetFakeBuilder, toSections, type FakeBuilder } from "@/lib/builder/client";
import { jobType } from "@/lib/jobs/registry";
import { JobYield } from "@/lib/jobs/yield";
import { createBrand } from "@/lib/services/brands";
import { getBrandBrief, updateBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { applyProposedEdit, deliverJob, quoteJob } from "@/lib/services/jobs";

let ctx: Ctx;
let fake: FakeBuilder;

beforeAll(async () => {
  const [u] = await db.insert(schema.users).values({ email: `builder-${Date.now()}@test.dev`, name: "Ana" }).returning();
  ctx = { userId: u.id, role: "user" };
});

beforeEach(() => {
  process.env.BUILDER_MODE = "fake";
  process.env.BUILDER_POLL_MS = "0";
  fake = resetFakeBuilder();
});

afterAll(async () => {
  delete process.env.BUILDER_MODE;
  await sql.end();
});

const COMPLETE = {
  oneLiner: "Refillable scalp oil for thinning hair",
  customer: "Women in their 40s noticing thinning",
  problem: "Treatments feel medical and harsh",
  alternative: "Minoxidil foam",
  positioning: "A ritual, not a prescription",
  price: "$38 per kit",
  channels: ["Shopify store"],
  goals: "First 100 orders by March",
};

describe("section mapping", () => {
  it("round-trips agent fields through builder sections and drops empties", () => {
    const sections = toSections({ oneLiner: "x", price: "$5", nameDirections: ["A"] });
    expect(sections).toEqual({ one_liner: "x", product_price: "$5", name_directions: ["A"] });
    expect(fromSections({ ...sections, goals: "", unknown_section: "y" })).toEqual({ oneLiner: "x", price: "$5", nameDirections: ["A"] });
  });
});

describe("brief owned by the builder", () => {
  it("provisions the builder brand and writes changes there first", async () => {
    const brand = await createBrand(ctx, { name: "Rootwell" });
    const linked = await db.query.brands.findFirst({ where: eq(schema.brands.id, brand.id) });
    expect(linked?.builderBrandId).toBeTruthy();

    await updateBrandBrief(ctx, brand.id, { oneLiner: "Scalp oil", channels: ["Amazon"] }, "chat");
    await updateBrandBrief(ctx, brand.id, { channels: [] }, "chat"); // clearing reaches the builder too
    const remote = fake.brands.get(linked!.builderBrandId!)!;
    expect(remote.fields).toEqual({ oneLiner: "Scalp oil" });
    const row = await db.query.briefVersions.findFirst({
      where: (t, { eq }) => eq(t.brandId, brand.id),
      orderBy: (t, { desc }) => desc(t.version),
    });
    expect(row?.builderVersion).toBe(remote.version);
  });

  it("pulls edits made in the builder into the brief", async () => {
    const brand = await createBrand(ctx, { name: "Pulled" });
    await updateBrandBrief(ctx, brand.id, { oneLiner: "Scalp oil" }, "chat");
    const { builderBrandId } = (await db.query.brands.findFirst({ where: eq(schema.brands.id, brand.id) }))!;
    const owner = (await db.query.users.findFirst({ where: eq(schema.users.id, ctx.userId) }))!;
    await builder().putBrief(owner.builderUserId!, builderBrandId!, { positioning: "Gentle" }, "cli");

    const brief = await getBrandBrief(ctx, brand.id);
    expect(brief.fields).toEqual({ oneLiner: "Scalp oil", positioning: "Gentle" });
    expect(brief.stale).toBe(false);
    const again = await getBrandBrief(ctx, brand.id); // no new version when nothing moved
    expect(again.version).toBe(brief.version);
  });

  it("copies an existing local brief over when a brand is linked later", async () => {
    delete process.env.BUILDER_MODE;
    const brand = await createBrand(ctx, { name: "Legacy" });
    await updateBrandBrief(ctx, brand.id, { oneLiner: "Old idea" }, "chat");
    process.env.BUILDER_MODE = "fake";

    const brief = await getBrandBrief(ctx, brand.id);
    expect(brief.fields).toEqual({ oneLiner: "Old idea" });
    const { builderBrandId } = (await db.query.brands.findFirst({ where: eq(schema.brands.id, brand.id) }))!;
    expect(fake.brands.get(builderBrandId!)!.fields).toEqual({ oneLiner: "Old idea" });
  });

  it("refuses the write when the builder rejects it, leaving the cache alone", async () => {
    const brand = await createBrand(ctx, { name: "Down" });
    vi.spyOn(fake, "putBrief").mockRejectedValueOnce(new Error("builder down"));
    await expect(updateBrandBrief(ctx, brand.id, { oneLiner: "x" }, "chat")).rejects.toThrow("builder down");
    const rows = await db.query.briefVersions.findMany({ where: (t, { eq }) => eq(t.brandId, brand.id) });
    expect(rows.map((r) => r.version)).toEqual([0]);
  });
});

describe("brand_research job", () => {
  it("won't quote on an incomplete brief and names what's missing", async () => {
    const brand = await createBrand(ctx, { name: "Thin" });
    await updateBrandBrief(ctx, brand.id, { oneLiner: "x" }, "chat");
    await expect(quoteJob(ctx, brand.id, "brand_research")).rejects.toThrow(/Missing: Customer, Problem/);
  });

  it("runs in the builder, relays progress, and applies proposals there", async () => {
    const brand = await createBrand(ctx, { name: "Researched" });
    await updateBrandBrief(ctx, brand.id, COMPLETE, "chat");
    const job = await quoteJob(ctx, brand.id, "brand_research");
    expect(job.priceCents).toBe(0);

    const steps: string[] = [];
    const def = jobType("brand_research");
    const result = await def.run!({}, { brandId: brand.id, brief: COMPLETE, progress: async (s) => void steps.push(s) });
    expect(steps).toEqual(["understand", "market_scan", "customer_insight", "opportunities", "focus_plan", "report"]);

    await db.update(schema.jobs).set({ status: "in_progress" }).where(eq(schema.jobs.id, job.id));
    await deliverJob(job.id, result, "agent");
    const msg = (await db.query.messages.findMany()).find((m) => m.attachments.jobRefs?.includes(job.id) && m.attachments.proposedEdits);
    expect(msg?.attachments.proposedEdits?.[0].builderProposalId).toBeTruthy();

    await applyProposedEdit(ctx, msg!.id, 0);
    const brief = await getBrandBrief(ctx, brand.id);
    expect(brief.fields.positioning).toBe("The gentle daily ritual for thinning hair");
    expect([...fake.proposals.values()][0].status).toBe("accepted");
  });
});

describe("brand_research on a serverless host", () => {
  it("yields before its deadline and resumes the same builder run", async () => {
    const brand = await createBrand(ctx, { name: "Sliced" });
    await updateBrandBrief(ctx, brand.id, COMPLETE, "chat");
    const def = jobType("brand_research");
    const steps: string[] = [];
    let state: Record<string, unknown> | null = null;
    const helpers = (deadlineAt: number) => ({
      brandId: brand.id,
      brief: COMPLETE,
      progress: async (s: string) => void steps.push(s),
      state,
      saveState: async (s: Record<string, unknown>) => void (state = s),
      deadlineAt,
    });

    // Too little time left to advance: submit, save the run id, hand back.
    await expect(def.run!({}, helpers(Date.now() + 1_000))).rejects.toBeInstanceOf(JobYield);
    expect(state).toMatchObject({ builderRunId: expect.any(String) });
    const runId = (state as unknown as { builderRunId: string }).builderRunId;

    // Next tick: plenty of time; the same run finishes, no second run is submitted.
    const result = await def.run!({}, helpers(Date.now() + 280_000));
    expect(result.builderRunId).toBe(runId);
    expect(fake.runs.size).toBe(1);
    expect(steps).toEqual(["understand", "market_scan", "customer_insight", "opportunities", "focus_plan", "report"]);
  });

  it("yields with a wait when the builder makes no progress", async () => {
    const brand = await createBrand(ctx, { name: "Busy" });
    await updateBrandBrief(ctx, brand.id, COMPLETE, "chat");
    const stuck = vi.spyOn(fake, "advanceRun").mockImplementation(async (_a, runId) => ({ id: runId, status: "running", completedSteps: [], error: null }));
    const def = jobType("brand_research");
    const err = await def
      .run!({}, { brandId: brand.id, brief: COMPLETE, progress: async () => {}, state: null, saveState: async () => {}, deadlineAt: Date.now() + 280_000 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(JobYield);
    expect((err as JobYield).waitMs).toBeGreaterThan(0);
    stuck.mockRestore();
  });
});

describe("http client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.BUILDER_MODE = "fake";
  });

  it("unwraps the envelope, sends the service token and act-as, and maps errors", async () => {
    delete process.env.BUILDER_MODE;
    process.env.BUILDER_API_URL = "http://builder.test/";
    process.env.BUILDER_SERVICE_TOKEN = "svc";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/brief?format=fields")) {
        return Response.json({ ok: true, data: { version: 3, fields: { one_liner: "x", product_price: "$5" } } });
      }
      return Response.json({ ok: false, data: null, errors: [{ code: "not_eligible", message: "Answer 2 more" }] }, { status: 409 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await builder().getBrief("u1", "b1")).toEqual({ version: 3, fields: { oneLiner: "x", price: "$5" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://builder.test/v1/brands/b1/brief?format=fields");
    expect(init.headers).toMatchObject({ authorization: "Bearer svc", "x-vybd-act-as": "u1" });
    await expect(builder().submitRun("u1", "b1")).rejects.toMatchObject({ status: 409, message: "Answer 2 more" });
    delete process.env.BUILDER_API_URL;
  });
});
