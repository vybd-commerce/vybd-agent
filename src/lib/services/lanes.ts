import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type Ctx, ForbiddenError, InvalidStateError, NotFoundError } from "./context";
import { getBrand, getMemberBrand } from "./brands";
import { emitBrandEvent } from "./events";

// Keep in sync with the backfill in drizzle/0009_lanes.sql.
export const DEFAULT_LANES = [
  { key: "positioning", title: "Positioning" },
  { key: "research", title: "Research" },
  { key: "product", title: "Product" },
  { key: "sourcing", title: "Sourcing" },
] as const;

export type Lane = typeof schema.lanes.$inferSelect;
export type LaneTask = typeof schema.laneTasks.$inferSelect;

/** Called once from createBrand. Existing brands got theirs from the migration. */
export async function createDefaultLanes(brandId: string) {
  await db
    .insert(schema.lanes)
    .values(DEFAULT_LANES.map((l, position) => ({ brandId, ...l, position })))
    .onConflictDoNothing();
}

/** Lanes with their tasks, in display order. Operators can read too. */
export async function listLanes(ctx: Ctx, brandId: string) {
  await getBrand(ctx, brandId);
  const lanes = await db.query.lanes.findMany({
    where: eq(schema.lanes.brandId, brandId),
    orderBy: asc(schema.lanes.position),
  });
  const tasks = lanes.length
    ? await db.query.laneTasks.findMany({
        where: inArray(
          schema.laneTasks.laneId,
          lanes.map((l) => l.id),
        ),
        orderBy: [asc(schema.laneTasks.position), asc(schema.laneTasks.createdAt)],
      })
    : [];
  return lanes.map((lane) => ({ ...lane, tasks: tasks.filter((t) => t.laneId === lane.id) }));
}

/** The lane plus its brand, after checking the caller is on the team. */
async function memberLane(ctx: Ctx, laneId: string) {
  const lane = await db.query.lanes.findFirst({ where: eq(schema.lanes.id, laneId) });
  if (!lane) throw new NotFoundError("Lane not found");
  const brand = await getMemberBrand(ctx, lane.brandId);
  return { lane, brand };
}

/** Take an unowned lane. The update only matches while owner_id is null, so of two racing claims exactly one wins. */
export async function claimLane(ctx: Ctx, laneId: string): Promise<Lane> {
  const { lane } = await memberLane(ctx, laneId);
  const [claimed] = await db
    .update(schema.lanes)
    .set({ ownerId: ctx.userId })
    .where(and(eq(schema.lanes.id, laneId), isNull(schema.lanes.ownerId)))
    .returning();
  if (claimed) {
    await emitBrandEvent(lane.brandId, { type: "lanes" });
    return claimed;
  }
  const current = await db.query.lanes.findFirst({ where: eq(schema.lanes.id, laneId) });
  if (current?.ownerId === ctx.userId) return current;
  throw new InvalidStateError("Someone else already owns this lane");
}

/** Give a lane back. Its owner can, and so can the brand owner. */
export async function releaseLane(ctx: Ctx, laneId: string): Promise<Lane> {
  const { lane, brand } = await memberLane(ctx, laneId);
  if (lane.ownerId === null) return lane;
  if (lane.ownerId !== ctx.userId && brand.ownerId !== ctx.userId) {
    throw new ForbiddenError("Only the lane owner or the brand owner can release this lane");
  }
  const [released] = await db
    .update(schema.lanes)
    .set({ ownerId: null })
    .where(eq(schema.lanes.id, laneId))
    .returning();
  await emitBrandEvent(lane.brandId, { type: "lanes" });
  return released;
}

/** Append a task to a lane's checklist. Any member (or their agent) can add. */
export async function addLaneTask(ctx: Ctx, laneId: string, title: string): Promise<LaneTask> {
  const { lane } = await memberLane(ctx, laneId);
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new InvalidStateError("Task title is empty");
  const [task] = await db
    .insert(schema.laneTasks)
    .values({
      laneId,
      title: clean,
      position: sql`(select coalesce(max(${schema.laneTasks.position}) + 1, 0) from ${schema.laneTasks} where ${schema.laneTasks.laneId} = ${laneId})`,
    })
    .returning();
  await emitBrandEvent(lane.brandId, { type: "lanes" });
  return task;
}

/** Tick or untick a task. Only the lane's owner can. */
export async function setLaneTaskDone(ctx: Ctx, taskId: string, done: boolean): Promise<LaneTask> {
  const task = await db.query.laneTasks.findFirst({ where: eq(schema.laneTasks.id, taskId) });
  if (!task) throw new NotFoundError("Task not found");
  const { lane } = await memberLane(ctx, task.laneId);
  if (lane.ownerId !== ctx.userId) throw new ForbiddenError("Only the lane owner can tick its tasks");
  const [updated] = await db
    .update(schema.laneTasks)
    .set({ done, doneBy: done ? ctx.userId : null })
    .where(eq(schema.laneTasks.id, taskId))
    .returning();
  await emitBrandEvent(lane.brandId, { type: "lanes" });
  return updated;
}
