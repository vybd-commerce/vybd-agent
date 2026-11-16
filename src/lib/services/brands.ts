import { and, asc, desc, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, schema } from "@/db";
import type { Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";
import { type Ctx, ForbiddenError, NotFoundError } from "./context";
import { builderEnabled } from "@/lib/builder/client";
import { ensureBuilderBrand } from "./builder-sync";
import { emitBrandEvent } from "./events";

const slugSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);

export type Brand = typeof schema.brands.$inferSelect;

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${base || "brand"}-${slugSuffix()}`;
}

/** Brands the caller owns or is a member of, newest first. */
export async function listBrands(ctx: Ctx) {
  const rows = await db
    .select({ brand: schema.brands })
    .from(schema.brands)
    .innerJoin(
      schema.brandMembers,
      and(eq(schema.brandMembers.brandId, schema.brands.id), eq(schema.brandMembers.userId, ctx.userId)),
    )
    .orderBy(desc(schema.brands.createdAt));
  return rows.map((r) => r.brand);
}

export async function createBrand(ctx: Ctx, input: { name?: string }) {
  const name = input.name?.trim() || "Untitled brand";
  const [brand] = await db
    .insert(schema.brands)
    .values({ ownerId: ctx.userId, name, slug: slugify(name) })
    .returning();
  await db.insert(schema.brandMembers).values({ brandId: brand.id, userId: ctx.userId, role: "owner" });
  await db.insert(schema.briefVersions).values({ brandId: brand.id, version: 0, fields: {}, source: "chat" });
  // Link the Brand Builder brand now; if the builder is down, the first brief read or write retries.
  if (builderEnabled()) await ensureBuilderBrand(brand.id).catch((err) => console.error("[builder] provision failed", err));
  return brand;
}

export async function isMember(brandId: string, userId: string) {
  const row = await db.query.brandMembers.findFirst({
    where: and(eq(schema.brandMembers.brandId, brandId), eq(schema.brandMembers.userId, userId)),
  });
  return Boolean(row);
}

/** Load a brand the caller may read: owner, member, or operator (they fulfil its jobs). */
export async function getBrand(ctx: Ctx, brandId: string): Promise<Brand> {
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
  if (!brand) throw new NotFoundError("Brand not found");
  if (brand.ownerId === ctx.userId || ctx.role === "operator") return brand;
  if (!(await isMember(brandId, ctx.userId))) throw new ForbiddenError("Not your brand");
  return brand;
}

/** Load a brand the caller works on as part of the team: owner or member. Chat, brief edits, quotes. */
export async function getMemberBrand(ctx: Ctx, brandId: string): Promise<Brand> {
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
  if (!brand) throw new NotFoundError("Brand not found");
  if (brand.ownerId !== ctx.userId && !(await isMember(brandId, ctx.userId))) throw new ForbiddenError("Not your brand");
  return brand;
}

export async function getOwnedBrand(ctx: Ctx, brandId: string): Promise<Brand> {
  const brand = await getBrand(ctx, brandId);
  if (brand.ownerId !== ctx.userId) throw new ForbiddenError("Not your brand");
  return brand;
}

export type Member = { userId: string; name: string | null; email: string | null; image: string | null; role: "owner" | "member" };

/** Everyone on the brand, owner first, then by join date. */
export async function listMembers(brandId: string): Promise<Member[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
      role: schema.brandMembers.role,
      joinedAt: schema.brandMembers.joinedAt,
    })
    .from(schema.brandMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.brandMembers.userId))
    .where(eq(schema.brandMembers.brandId, brandId))
    .orderBy(asc(schema.brandMembers.joinedAt));
  return rows
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1))
    .map((m) => ({ userId: m.userId, name: m.name, email: m.email, image: m.image, role: m.role }));
}

export async function getBrandBySlug(slug: string) {
  return db.query.brands.findFirst({ where: eq(schema.brands.slug, slug) });
}

export async function renameBrand(ctx: Ctx, brandId: string, name: string) {
  await getOwnedBrand(ctx, brandId);
  const [brand] = await db
    .update(schema.brands)
    .set({ name: name.trim().slice(0, 80) || "Untitled brand" })
    .where(eq(schema.brands.id, brandId))
    .returning();
  await emitBrandEvent(brandId, { type: "brand" });
  return brand;
}

const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.key === s);

/** Move the brand forward to `stage`. Never moves backwards. */
export async function advanceStage(brandId: string, stage: Stage) {
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
  if (!brand || stageIndex(brand.stage) >= stageIndex(stage)) return;
  await db
    .update(schema.brands)
    .set({ stage })
    .where(and(eq(schema.brands.id, brandId), eq(schema.brands.stage, brand.stage)));
  await emitBrandEvent(brandId, { type: "brand" });
}

export async function setShareSettings(
  ctx: Ctx,
  brandId: string,
  input: { published?: boolean; hiddenFields?: string[] },
) {
  await getOwnedBrand(ctx, brandId);
  const [brand] = await db
    .update(schema.brands)
    .set({
      ...(input.published !== undefined && { sharePublished: input.published }),
      ...(input.hiddenFields && { shareHiddenFields: input.hiddenFields }),
    })
    .where(eq(schema.brands.id, brandId))
    .returning();
  await emitBrandEvent(brandId, { type: "brand" });
  return brand;
}
