import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema, sql } from "@/db";
import { createBrand } from "@/lib/services/brands";
import { getBrandBrief, updateBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { createSharePage, getFeedback, getPublicPage, submitFeedback } from "@/lib/services/feedback";
import { approveJob, cancelJob, deliverJob, getJob, markJobPaid, quoteJob } from "@/lib/services/jobs";
import { runTool } from "@/lib/tools";

let ctx: Ctx;
let other: Ctx;

beforeAll(async () => {
  const [a, b] = await db
    .insert(schema.users)
    .values([{ email: `a-${Date.now()}@test.dev` }, { email: `b-${Date.now()}@test.dev` }])
    .returning();
  ctx = { userId: a.id, role: "user" };
  other = { userId: b.id, role: "user" };
});

afterAll(async () => {
  await sql.end();
});

describe("brief versions", () => {
  it("bumps the version on change, records the source, and skips no-ops", async () => {
    const brand = await createBrand(ctx, { name: "Rootwell" });
    const v1 = await updateBrandBrief(ctx, brand.id, { oneLiner: "Scalp oil" }, "chat", { pending: ["customer"] });
    expect(v1.version).toBe(1);
    expect(v1.pending).toEqual(["customer"]);

    const v2 = await updateBrandBrief(ctx, brand.id, { customer: "Women 30-50" }, "mcp");
    expect(v2.version).toBe(2);
    expect(v2.pending).toEqual([]); // the field being asked about got filled

    const same = await updateBrandBrief(ctx, brand.id, { customer: "Women 30-50" }, "chat");
    expect(same.version).toBe(2);

    const rows = await db.query.briefVersions.findMany({ where: (t, { eq }) => eq(t.brandId, brand.id) });
    expect(rows.map((r) => r.source).sort()).toEqual(["chat", "chat", "mcp"]);
  });

  it("serializes concurrent writers without losing fields", async () => {
    const brand = await createBrand(ctx, {});
    await Promise.all([
      updateBrandBrief(ctx, brand.id, { oneLiner: "x" }, "chat"),
      updateBrandBrief(ctx, brand.id, { customer: "y" }, "mcp"),
      updateBrandBrief(ctx, brand.id, { price: "$10" }, "user_edit"),
    ]);
    const brief = await getBrandBrief(ctx, brand.id);
    expect(brief.fields).toEqual({ oneLiner: "x", customer: "y", price: "$10" });
    expect(brief.version).toBe(3);
  });

  it("keeps other users out", async () => {
    const brand = await createBrand(ctx, {});
    await expect(updateBrandBrief(other, brand.id, { oneLiner: "hijack" }, "chat")).rejects.toThrow();
    await expect(getBrandBrief(other, brand.id)).rejects.toThrow();
  });
});

describe("jobs", () => {
  it("starts a free job immediately on approval", async () => {
    const brand = await createBrand(ctx, {});
    const job = await quoteJob(ctx, brand.id, "market_snapshot");
    expect(job.status).toBe("quoted");
    expect(job.priceCents).toBe(0);
    const { job: approved, checkoutUrl } = await approveJob(ctx, job.id);
    expect(checkoutUrl).toBeUndefined();
    expect(approved.status).toBe("in_progress");
  });

  it("never starts a paid job before payment, and payment is idempotent", async () => {
    const brand = await createBrand(ctx, {});
    const job = await quoteJob(ctx, brand.id, "find_suppliers", { products: ["Scalp oil"] });
    const { job: afterApprove, checkoutUrl } = await approveJob(ctx, job.id);
    expect(afterApprove.status).toBe("quoted");
    expect(checkoutUrl).toContain(`/dev/checkout/${job.id}`);

    await markJobPaid(job.id, "pi_1");
    await markJobPaid(job.id, "pi_1"); // webhook retry
    const paid = await getJob(ctx, job.id);
    expect(paid.status).toBe("in_progress");
    expect(paid.events.filter((e) => e.kind === "status" && e.payload.to === "in_progress")).toHaveLength(1);
  });

  it("rejects invalid deliveries and illegal transitions", async () => {
    const brand = await createBrand(ctx, {});
    const job = await quoteJob(ctx, brand.id, "find_suppliers", { products: ["Oil"] });
    await expect(deliverJob(job.id, { suppliers: [] }, "operator")).rejects.toThrow();
    await cancelJob(ctx, job.id);
    await expect(approveJob(ctx, job.id)).rejects.toThrow(/cancelled/);
  });
});

describe("share page", () => {
  it("publishes only visible fields and counts responses", async () => {
    const brand = await createBrand(ctx, { name: "Snackwell" });
    await updateBrandBrief(ctx, brand.id, { oneLiner: "Protein snacks", customer: "Parents", openQuestions: ["secret"] }, "chat");
    expect(await getPublicPage(brand.slug)).toBeNull();
    await createSharePage(ctx, brand.id);
    const page = await getPublicPage(brand.slug);
    expect(page?.fields).toEqual({ oneLiner: "Protein snacks" }); // customer hidden by default, open questions never shown

    await submitFeedback(brand.slug, { wouldBuy: "yes", priceAnswer: "$5" });
    await submitFeedback(brand.slug, { wouldBuy: "no", email: "" });
    const fb = await getFeedback(ctx, brand.id);
    expect(fb.counts).toEqual({ yes: 1, maybe: 0, no: 1 });
    expect(fb.priceAnswers).toEqual(["$5"]);
  });
});

describe("tool table", () => {
  it("validates input before touching data", async () => {
    const res = await runTool("update_brand_brief", { brandId: "nope", fields: {} }, { ctx, surface: "mcp" });
    expect(res.ok).toBe(false);
  });

  it("writes MCP edits with source mcp", async () => {
    const created = await runTool("create_brand", { name: "Via MCP" }, { ctx, surface: "mcp" });
    const brandId = (created as { result: { id: string } }).result.id;
    await runTool("update_brand_brief", { brandId, fields: { oneLiner: "x" } }, { ctx, surface: "mcp" });
    const row = await db.query.briefVersions.findFirst({ where: (t, { and, eq }) => and(eq(t.brandId, brandId), eq(t.version, 1)) });
    expect(row?.source).toBe("mcp");
  });
});
