import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { type BriefFields, isFilled } from "@/lib/brief";
import { builder, builderEnabled } from "@/lib/builder/client";
import { NotFoundError } from "./context";
import { emitBrandEvent } from "./events";

/**
 * Keeps brief_versions in step with the Brand Builder, which owns the canonical brief.
 * Writes go to the builder first; brief_versions rows are the local cache (history, live flash,
 * fallback while the builder is down). Everything here is a no-op when the builder isn't configured.
 */

export type BuilderLink = { builderBrandId: string; actAs: string };

/** Builder user for the brand owner and the builder brand, created on first use. */
export async function ensureBuilderBrand(brandId: string): Promise<BuilderLink> {
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
  if (!brand) throw new NotFoundError("Brand not found");
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, brand.ownerId) });
  if (!owner) throw new NotFoundError("Owner not found");

  let actAs = owner.builderUserId;
  if (!actAs) {
    actAs = (await builder().upsertUser({ email: owner.email ?? `${owner.id}@users.vybd.ai`, name: owner.name })).id;
    await db.update(schema.users).set({ builderUserId: actAs }).where(eq(schema.users.id, owner.id));
  }
  if (brand.builderBrandId) return { builderBrandId: brand.builderBrandId, actAs };

  const { id } = await builder().createBrand(actAs, brand.name);
  // Two requests may race to provision; only the first link sticks and the loser adopts it.
  const [won] = await db
    .update(schema.brands)
    .set({ builderBrandId: id })
    .where(and(eq(schema.brands.id, brandId), isNull(schema.brands.builderBrandId)))
    .returning({ id: schema.brands.id });
  if (!won) {
    const linked = await db.query.brands.findFirst({ where: eq(schema.brands.id, brandId) });
    return { builderBrandId: linked!.builderBrandId!, actAs };
  }
  const link = { builderBrandId: id, actAs };

  // Existing brand: carry its brief over so the builder starts where the founder left off.
  const cached = await latestRow(brandId);
  if (cached && Object.keys(cached.fields).length > 0) {
    const { version } = await builder().putBrief(actAs, link.builderBrandId, cached.fields, "backfill");
    await db.update(schema.briefVersions).set({ builderVersion: version }).where(eq(schema.briefVersions.id, cached.id));
  }
  return link;
}

/** Write changed fields to the builder. Cleared fields are sent empty. Returns the builder version. */
export async function pushBrief(brandId: string, changed: BriefFields, source: string): Promise<number | null> {
  if (!builderEnabled()) return null;
  const link = await ensureBuilderBrand(brandId);
  const { version } = await builder().putBrief(link.actAs, link.builderBrandId, changed, source);
  return version;
}

/**
 * Pull the builder's brief into the cache when it moved on without us (proposal accepted, CLI edit).
 * Best effort: a builder outage leaves the cache as is and reports stale.
 */
export async function pullBrief(brandId: string): Promise<{ stale: boolean }> {
  if (!builderEnabled()) return { stale: false };
  try {
    const link = await ensureBuilderBrand(brandId);
    const remote = await builder().getBrief(link.actAs, link.builderBrandId);
    const cached = await latestRow(brandId);
    if (cached?.builderVersion === remote.version) return { stale: false };
    const changed = changedKeys(cached?.fields ?? {}, remote.fields);
    if (cached && changed.length === 0) {
      await db.update(schema.briefVersions).set({ builderVersion: remote.version }).where(eq(schema.briefVersions.id, cached.id));
      return { stale: false };
    }
    const version = (cached?.version ?? 0) + 1;
    const pending = (cached?.pending ?? []).filter((k) => !changed.includes(k));
    await db
      .insert(schema.briefVersions)
      .values({ brandId, version, fields: remote.fields, pending, source: "builder", builderVersion: remote.version })
      .onConflictDoNothing(); // a concurrent writer took this version; the next read syncs again
    await emitBrandEvent(brandId, { type: "brief", version, changed });
    return { stale: false };
  } catch (err) {
    console.error(`[builder] could not sync brief for ${brandId}`, err);
    return { stale: true };
  }
}

async function latestRow(brandId: string) {
  return db.query.briefVersions.findFirst({
    where: eq(schema.briefVersions.brandId, brandId),
    orderBy: desc(schema.briefVersions.version),
  });
}

function changedKeys(a: BriefFields, b: BriefFields): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof BriefFields>;
  return [...keys].filter((k) => (isFilled(a[k]) || isFilled(b[k])) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
