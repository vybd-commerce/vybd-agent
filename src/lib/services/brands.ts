import { and, desc, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, schema } from "@/db";
import type { Stage } from "@/lib/types";
import { STAGES } from "@/lib/types";
import { type Ctx, ForbiddenError, NotFoundError } from "./context";
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

export async function listBrands(ctx: Ctx) {
  return db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.ownerId, ctx.userId))
    .orderBy(desc(schema.brands.createdAt));
}

export async function createBrand(ctx: Ctx, input: { name?: string }) {
  const name = input.name?.trim() || "Untitled brand";
  const [brand] = await db
    .insert(schema.brands)
    .values({ ownerId: ctx.userId, name, slug: slugify(name) })
    .returning();
  await db.insert(schema.briefVersions).values({ brandId: brand.id, version: 0, fields: {}, source: "chat" });
  return brand;
}

/** Load a brand the caller may access. Operators can read any brand (they fulfil its jobs). */
export async function getBrand(ctx: Ctx, brandId: string): Promise<Brand> {
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
  if (!brand) throw new NotFoundError("Brand not found");
  if (brand.ownerId !== ctx.userId && ctx.role !== "operator") throw new ForbiddenError("Not your brand");
  return brand;
}

export async function getOwnedBrand(ctx: Ctx, brandId: string): Promise<Brand> {
  const brand = await getBrand(ctx, brandId);
  if (brand.ownerId !== ctx.userId) throw new ForbiddenError("Not your brand");
  return brand;
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
