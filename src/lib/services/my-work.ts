import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./context";

/**
 * "What's on my plate?" across every brand the caller is on: the lanes they own with their
 * open tasks, plus unowned lanes on their brands they could pick up.
 */
export async function myWork(ctx: Ctx, opts: { includeDone?: boolean } = {}) {
  const memberships = await db.query.brandMembers.findMany({ where: eq(schema.brandMembers.userId, ctx.userId) });
  if (!memberships.length) return { lanes: [], unowned: [] };
  const brandIds = memberships.map((m) => m.brandId);

  const [brands, lanes] = await Promise.all([
    db.query.brands.findMany({ where: inArray(schema.brands.id, brandIds) }),
    db.query.lanes.findMany({ where: inArray(schema.lanes.brandId, brandIds), orderBy: asc(schema.lanes.position) }),
  ]);
  const mine = lanes.filter((l) => l.ownerId === ctx.userId);
  const tasks = mine.length
    ? await db.query.laneTasks.findMany({
        where: and(
          inArray(
            schema.laneTasks.laneId,
            mine.map((l) => l.id),
          ),
          ...(opts.includeDone ? [] : [eq(schema.laneTasks.done, false)]),
        ),
        orderBy: [asc(schema.laneTasks.position), asc(schema.laneTasks.createdAt)],
      })
    : [];
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  return {
    lanes: mine.map((l) => ({
      brandId: l.brandId,
      brand: brandName.get(l.brandId) ?? "",
      laneId: l.id,
      lane: l.title,
      tasks: tasks.filter((t) => t.laneId === l.id).map((t) => ({ id: t.id, title: t.title, done: t.done })),
    })),
    unowned: lanes
      .filter((l) => l.ownerId === null)
      .map((l) => ({ brandId: l.brandId, brand: brandName.get(l.brandId) ?? "", laneId: l.id, lane: l.title })),
  };
}
