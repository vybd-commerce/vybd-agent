import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { createBrand, getBrand, listBrands, listMembers, renameBrand } from "@/lib/services/brands";
import { getBrandBrief, updateBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { getBrandState } from "@/lib/services/brand-state";
import { createSharePage, getFeedback, submitFeedback } from "@/lib/services/feedback";
import { acceptInvite, getOrCreateInvite, previewInvite, resetInvite } from "@/lib/services/invites";
import { approveJob, quoteJob } from "@/lib/services/jobs";

let owner: Ctx;
let friend: Ctx;
let stranger: Ctx;

beforeAll(async () => {
  const stamp = Date.now();
  const [a, b, c] = await db
    .insert(schema.users)
    .values([
      { email: `owner-${stamp}@test.dev`, name: "Owner" },
      { email: `friend-${stamp}@test.dev`, name: "Priya" },
      { email: `stranger-${stamp}@test.dev` },
    ])
    .returning();
  owner = { userId: a.id, role: "user" };
  friend = { userId: b.id, role: "user" };
  stranger = { userId: c.id, role: "user" };
});

afterAll(async () => {
  await sql.end();
});

describe("invites", () => {
  it("reuses one live link and previews it publicly", async () => {
    const brand = await createBrand(owner, { name: "Rootwell" });
    await updateBrandBrief(owner, brand.id, { oneLiner: "Scalp oil" }, "chat");
    const first = await getOrCreateInvite(owner, brand.id);
    const again = await getOrCreateInvite(owner, brand.id);
    expect(again.token).toBe(first.token);
    expect(first.url).toContain(`/join/${first.token}`);

    const preview = await previewInvite(first.token);
    expect(preview).toMatchObject({ status: "ok", brandName: "Rootwell", oneLiner: "Scalp oil", inviterName: "Owner" });
    await expect(getOrCreateInvite(stranger, brand.id)).rejects.toThrow();
  });

  it("lets several people join with one link, once each, and posts a join note", async () => {
    const brand = await createBrand(owner, { name: "Group chat brand" });
    const { token } = await getOrCreateInvite(owner, brand.id);
    expect(await acceptInvite(friend, token)).toEqual({ brandId: brand.id, joined: true });
    expect(await acceptInvite(friend, token)).toEqual({ brandId: brand.id, joined: false });
    expect(await acceptInvite(stranger, token)).toEqual({ brandId: brand.id, joined: true });

    const members = await listMembers(brand.id);
    expect(members.map((m) => m.role)).toEqual(["owner", "member", "member"]);
    expect((await listBrands(friend)).map((b) => b.id)).toContain(brand.id);

    const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.brandId, brand.id) });
    const notes = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, conv!.id) });
    expect(notes.filter((m) => m.role === "system").map((m) => m.content)).toContain("Priya joined the brand.");
  });

  it("gives members team access but keeps owner-only actions with the owner", async () => {
    const brand = await createBrand(owner, { name: "Shared" });
    const { token } = await getOrCreateInvite(owner, brand.id);
    await acceptInvite(friend, token);

    await expect(getBrand(friend, brand.id)).resolves.toBeTruthy();
    const v = await updateBrandBrief(friend, brand.id, { customer: "New parents" }, "chat");
    expect(v.version).toBe(1);
    const brief = await db.query.briefVersions.findFirst({ where: eq(schema.briefVersions.brandId, brand.id), orderBy: (t, { desc }) => desc(t.version) });
    expect(brief?.authorId).toBe(friend.userId);

    const job = await quoteJob(friend, brand.id, "find_suppliers");
    await expect(approveJob(friend, job.id)).rejects.toThrow();
    await expect(renameBrand(friend, brand.id, "Mine now")).rejects.toThrow();
    await expect(resetInvite(friend, brand.id)).rejects.toThrow();
    await expect(getBrandBrief(stranger, brand.id)).rejects.toThrow();
  });

  it("kills the old link on reset and rejects expired links", async () => {
    const brand = await createBrand(owner, {});
    const old = await getOrCreateInvite(owner, brand.id);
    const fresh = await resetInvite(owner, brand.id);
    expect(fresh.token).not.toBe(old.token);
    expect((await previewInvite(old.token)).status).toBe("expired");
    await expect(acceptInvite(stranger, old.token)).rejects.toThrow(/expired/);

    await db.update(schema.invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invites.token, fresh.token));
    await expect(acceptInvite(stranger, fresh.token)).rejects.toThrow(/expired/);
    expect((await previewInvite("nope")).status).toBe("missing");
  });
});

describe("brand score inputs", () => {
  it("counts one answer per responder and ignores the team's own answers", async () => {
    const brand = await createBrand(owner, { name: "Counted" });
    await updateBrandBrief(owner, brand.id, { oneLiner: "x", customer: "y", positioning: "z" }, "chat");
    await createSharePage(owner, brand.id);
    await submitFeedback(brand.slug, { wouldBuy: "yes" }, { ip: "1.1.1.1", userId: owner.userId });
    await submitFeedback(brand.slug, { wouldBuy: "no" }, { ip: "2.2.2.2" });
    await submitFeedback(brand.slug, { wouldBuy: "yes" }, { ip: "2.2.2.2" }); // changed their mind; latest wins
    await submitFeedback(brand.slug, { wouldBuy: "maybe" }, { ip: "3.3.3.3" });
    const fb = await getFeedback(owner, brand.id);
    expect(fb.total).toBe(4);
    expect(fb.counted).toEqual({ total: 2, yes: 1 });
  });

  it("celebrates in the thread exactly once when the bar is cleared", async () => {
    const brand = await createBrand(owner, { name: "Cleared" });
    await updateBrandBrief(
      owner,
      brand.id,
      {
        oneLiner: "Refillable scalp oil",
        customer: "Women in their 40s who noticed thinning after pregnancy and want something gentle",
        problem: "Harsh treatments",
        positioning: "A ritual",
        price: "$38",
        channels: ["Shopify"],
        nameDirections: ["A", "B", "C"],
        openQuestions: ["Bottle?"],
      },
      "chat",
    );
    const job = await quoteJob(owner, brand.id, "market_snapshot");
    await db
      .update(schema.jobs)
      .set({ status: "delivered", result: { priceBand: { low: 30, high: 45 } } })
      .where(eq(schema.jobs.id, job.id));
    await createSharePage(owner, brand.id);
    await acceptInvite(friend, (await getOrCreateInvite(owner, brand.id)).token);
    for (let i = 0; i < 10; i++) await submitFeedback(brand.slug, { wouldBuy: i < 3 ? "yes" : "maybe" }, { ip: `10.0.0.${i}` });

    const first = await getBrandState(owner, brand.id);
    expect(first.score.unlocked).toBe(true);
    expect(first.messages.filter((m) => m.attachments.unlock)).toHaveLength(1);
    const again = await getBrandState(friend, brand.id);
    expect(again.messages.filter((m) => m.attachments.unlock)).toHaveLength(1);
  });
});
