import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { type BriefFields, type BriefFieldKey, BRIEF_FIELDS, mergeBrief, isUsable } from "@/lib/brief";
import type { Ctx } from "./context";
import { getBrand, getMemberBrand } from "./brands";
import { emitBrandEvent } from "./events";
import { pullBrief, pushBrief } from "./builder-sync";

// Drizzle wraps driver errors; the Postgres code may be on the error or its cause.
function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export type BriefSource = "chat" | "job" | "user_edit" | "mcp";

export async function latestBrief(brandId: string) {
  const row = await db.query.briefVersions.findFirst({
    where: eq(schema.briefVersions.brandId, brandId),
    orderBy: desc(schema.briefVersions.version),
  });
  return (
    row ?? { version: 0, fields: {} as BriefFields, pending: [] as string[], source: "chat" as const, createdAt: null, builderVersion: null }
  );
}

/** The brief as the Brand Builder has it now, via the cache. `stale` when the builder couldn't be reached. */
export async function syncedBrief(brandId: string) {
  const { stale } = await pullBrief(brandId);
  return { ...(await latestBrief(brandId)), stale };
}

export async function getBrandBrief(ctx: Ctx, brandId: string) {
  const brand = await getBrand(ctx, brandId);
  const brief = await syncedBrief(brandId);
  return {
    brandId,
    name: brand.name,
    stage: brand.stage,
    version: brief.version,
    fields: brief.fields,
    pending: brief.pending,
    usable: isUsable(brief.fields),
    updatedAt: brief.createdAt?.toISOString() ?? null,
    stale: brief.stale,
  };
}

/**
 * Patch brief fields and write a new version. No-op patches (nothing changed) don't bump the version.
 * Retries on version conflicts so concurrent writers (chat + MCP + job) never clobber each other.
 * Field changes go to the Brand Builder first; if it refuses or is down, nothing is written here.
 */
export async function updateBrandBrief(
  ctx: Ctx,
  brandId: string,
  patch: BriefFields,
  source: BriefSource,
  opts: { pending?: BriefFieldKey[]; skipOwnerCheck?: boolean } = {},
) {
  if (!opts.skipOwnerCheck) await getMemberBrand(ctx, brandId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await latestBrief(brandId);
    const { fields, diff } = mergeBrief(current.fields, patch);
    const changed = Object.keys(diff);
    // Filled fields stop being "asking now"; an explicit pending list replaces the old one.
    const pendingBase = opts.pending ?? (current.pending as BriefFieldKey[]);
    const pending = pendingBase.filter((k) => BRIEF_FIELDS.includes(k) && !changed.includes(k));
    const pendingChanged = JSON.stringify(pending) !== JSON.stringify(current.pending);
    if (changed.length === 0 && !pendingChanged) {
      return { version: current.version, fields: current.fields, diff, pending: current.pending, usable: isUsable(fields) };
    }
    const builderVersion = changed.length
      ? await pushBrief(brandId, Object.fromEntries(changed.map((k) => [k, diff[k as BriefFieldKey]!.to])) as BriefFields, source)
      : current.builderVersion;
    try {
      const version = current.version + 1;
      await db
        .insert(schema.briefVersions)
        .values({ brandId, version, fields, pending, source, authorId: ctx.userId, builderVersion });
      await emitBrandEvent(brandId, { type: "brief", version, changed });
      return { version, fields, diff, pending, usable: isUsable(fields) };
    } catch (err) {
      if (isUniqueViolation(err)) continue; // someone else wrote this version first; re-read and retry
      throw err;
    }
  }
  throw new Error("Could not update brief after concurrent writes");
}

export async function setPending(ctx: Ctx, brandId: string, pending: BriefFieldKey[], source: BriefSource) {
  return updateBrandBrief(ctx, brandId, {}, source, { pending });
}

export async function briefHistory(ctx: Ctx, brandId: string) {
  await getBrand(ctx, brandId);
  return db
    .select()
    .from(schema.briefVersions)
    .where(eq(schema.briefVersions.brandId, brandId))
    .orderBy(desc(schema.briefVersions.version))
    .limit(50);
}
