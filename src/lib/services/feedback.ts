import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { BRIEF_FIELDS, type BriefFieldKey, type BriefFields } from "@/lib/brief";
import { appUrl } from "@/lib/stripe";
import type { Ctx } from "./context";
import { NotFoundError } from "./context";
import { advanceStage, getBrand, getBrandBySlug, getMemberBrand, isMember } from "./brands";
import { latestBrief } from "./brief";
import { emitBrandEvent } from "./events";

// Open questions are internal notes and never go public. Everything else is shareable;
// founders hide fields from the Brief tab (brands.share_hidden_fields, default in the schema).
export const SHAREABLE_FIELDS: BriefFieldKey[] = BRIEF_FIELDS.filter((k) => k !== "openQuestions" && k !== "goals");

export function shareUrl(slug: string) {
  return `${appUrl()}/b/${slug}`;
}

/** Publish the brief as a public feedback page. */
export async function createSharePage(ctx: Ctx, brandId: string, opts: { hiddenFields?: string[] } = {}) {
  const brand = await getMemberBrand(ctx, brandId);
  const hidden = opts.hiddenFields ?? brand.shareHiddenFields;
  await db
    .update(schema.brands)
    .set({ sharePublished: true, shareHiddenFields: hidden })
    .where(eq(schema.brands.id, brandId));
  await advanceStage(brandId, "validate");
  await emitBrandEvent(brandId, { type: "brand" });
  return { url: shareUrl(brand.slug), slug: brand.slug, hiddenFields: hidden };
}

export function publicFields(fields: BriefFields, hidden: string[]): Partial<BriefFields> {
  return Object.fromEntries(
    SHAREABLE_FIELDS.filter((k) => !hidden.includes(k) && fields[k] !== undefined).map((k) => [k, fields[k]]),
  );
}

export async function getPublicPage(slug: string) {
  const brand = await getBrandBySlug(slug);
  if (!brand || !brand.sharePublished) return null;
  const brief = await latestBrief(brand.id);
  return { brandId: brand.id, name: brand.name, slug: brand.slug, fields: publicFields(brief.fields, brand.shareHiddenFields) };
}

export const feedbackInputSchema = z.object({
  wouldBuy: z.enum(["yes", "maybe", "no"]),
  priceAnswer: z.string().trim().max(200).optional(),
  comment: z.string().trim().max(2000).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
});

/** Salted so stored hashes can't be reversed to IPs; per brand so they can't be joined across brands. */
export function hashIp(ip: string, brandId: string) {
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? "vybd"}:${brandId}:${ip}`).digest("hex").slice(0, 32);
}

export async function submitFeedback(
  slug: string,
  input: z.infer<typeof feedbackInputSchema>,
  who: { ip?: string | null; userId?: string | null } = {},
) {
  const brand = await getBrandBySlug(slug);
  if (!brand || !brand.sharePublished) throw new NotFoundError("Page not found");
  const data = feedbackInputSchema.parse(input);
  const fromTeam = Boolean(who.userId && (brand.ownerId === who.userId || (await isMember(brand.id, who.userId))));
  await db.insert(schema.feedback).values({
    brandId: brand.id,
    wouldBuy: data.wouldBuy,
    priceAnswer: data.priceAnswer || null,
    comment: data.comment || null,
    email: data.email || null,
    ipHash: who.ip ? hashIp(who.ip, brand.id) : null,
    fromTeam,
  });
  await emitBrandEvent(brand.id, { type: "feedback" });
}

/** Aggregated responses: counts by answer, plus recent comments and price answers. */
export async function getFeedback(ctx: Ctx, brandId: string) {
  const brand = await getBrand(ctx, brandId);
  const rows = await db
    .select()
    .from(schema.feedback)
    .where(eq(schema.feedback.brandId, brandId))
    .orderBy(desc(schema.feedback.createdAt));
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of rows) counts[r.wouldBuy]++;
  // What the Brand Score counts: no team answers, and only the latest answer per responder (rows are newest first).
  const seen = new Set<string>();
  const counted = { total: 0, yes: 0 };
  for (const r of rows) {
    if (r.fromTeam) continue;
    if (r.ipHash) {
      if (seen.has(r.ipHash)) continue;
      seen.add(r.ipHash);
    }
    counted.total++;
    if (r.wouldBuy === "yes") counted.yes++;
  }
  return {
    published: brand.sharePublished,
    url: brand.sharePublished ? shareUrl(brand.slug) : null,
    hiddenFields: brand.shareHiddenFields,
    total: rows.length,
    counts,
    counted,
    emails: rows.filter((r) => r.email).length,
    priceAnswers: rows.map((r) => r.priceAnswer).filter((p): p is string => Boolean(p)).slice(0, 20),
    comments: rows
      .filter((r) => r.comment)
      .slice(0, 20)
      .map((r) => ({ wouldBuy: r.wouldBuy, comment: r.comment!, createdAt: r.createdAt })),
  };
}
