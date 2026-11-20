import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema, sql } from "@/db";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { brandChannel } from "@/lib/services/events";
import { acceptInvite, getOrCreateInvite } from "@/lib/services/invites";
import { addLaneTask, claimLane, DEFAULT_LANES, listLanes, releaseLane, setLaneTaskDone } from "@/lib/services/lanes";

let owner: Ctx;
let priya: Ctx;
let sam: Ctx;
let stranger: Ctx;

beforeAll(async () => {
  const stamp = Date.now();
  const users = await db
    .insert(schema.users)
    .values(["owner", "priya", "sam", "stranger"].map((n) => ({ email: `${n}-${stamp}@test.dev`, name: n })))
    .returning();
  [owner, priya, sam, stranger] = users.map((u) => ({ userId: u.id, role: "user" as const }));
});

afterAll(async () => {
  await sql.end();
});

/** A brand with the owner, Priya and Sam on the team. Returns its lanes. */
async function teamBrand() {
  const brand = await createBrand(owner, { name: "Lanes brand" });
  const { token } = await getOrCreateInvite(owner, brand.id);
  await acceptInvite(priya, token);
  await acceptInvite(sam, token);
  return { brand, lanes: await listLanes(owner, brand.id) };
}

describe("lanes", () => {
  it("gives every new brand the default lanes, unowned and in order", async () => {
    const { lanes } = await teamBrand();
    expect(lanes.map((l) => l.key)).toEqual(DEFAULT_LANES.map((l) => l.key));
    expect(lanes.every((l) => l.ownerId === null && l.tasks.length === 0)).toBe(true);
  });

  it("lets a member claim a free lane and release it", async () => {
    const { lanes } = await teamBrand();
    const lane = lanes[0];
    expect((await claimLane(priya, lane.id)).ownerId).toBe(priya.userId);
    expect((await claimLane(priya, lane.id)).ownerId).toBe(priya.userId); // idempotent
    await expect(claimLane(sam, lane.id)).rejects.toThrow("already owns");
    await expect(releaseLane(sam, lane.id)).rejects.toThrow();
    expect((await releaseLane(priya, lane.id)).ownerId).toBeNull();
    expect((await claimLane(sam, lane.id)).ownerId).toBe(sam.userId);
  });

  it("lets the brand owner release someone else's lane", async () => {
    const { lanes } = await teamBrand();
    await claimLane(priya, lanes[1].id);
    expect((await releaseLane(owner, lanes[1].id)).ownerId).toBeNull();
  });

  it("gives a contested lane to exactly one of two simultaneous claims", async () => {
    const { lanes } = await teamBrand();
    const results = await Promise.allSettled([claimLane(priya, lanes[2].id), claimLane(sam, lanes[2].id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ ownerId: string | null }>).value;
    const [after] = (await listLanes(owner, lanes[2].brandId)).filter((l) => l.id === lanes[2].id);
    expect(after.ownerId).toBe(winner.ownerId);
  });

  it("keeps a checklist in order where only the lane owner ticks tasks", async () => {
    const { brand, lanes } = await teamBrand();
    const lane = lanes[3];
    await claimLane(sam, lane.id);
    const first = await addLaneTask(priya, lane.id, "  Shortlist three suppliers ");
    const second = await addLaneTask(sam, lane.id, "Ask for samples");
    expect(first.title).toBe("Shortlist three suppliers");
    expect([first.position, second.position]).toEqual([0, 1]);
    await expect(addLaneTask(sam, lane.id, "   ")).rejects.toThrow();

    await expect(setLaneTaskDone(priya, first.id, true)).rejects.toThrow("lane owner");
    const ticked = await setLaneTaskDone(sam, first.id, true);
    expect(ticked).toMatchObject({ done: true, doneBy: sam.userId });
    expect(await setLaneTaskDone(sam, first.id, false)).toMatchObject({ done: false, doneBy: null });

    const [withTasks] = (await listLanes(priya, brand.id)).filter((l) => l.id === lane.id);
    expect(withTasks.tasks.map((t) => t.title)).toEqual(["Shortlist three suppliers", "Ask for samples"]);
  });

  it("notifies the brand channel on every change", async () => {
    const { brand, lanes } = await teamBrand();
    const seen: string[] = [];
    const listener = await sql.listen(brandChannel(brand.id), (payload) => seen.push(JSON.parse(payload).type));
    const task = await addLaneTask(owner, lanes[0].id, "Draft one-liner");
    await claimLane(owner, lanes[0].id);
    await setLaneTaskDone(owner, task.id, true);
    await releaseLane(owner, lanes[0].id);
    await expect.poll(() => seen.length).toBe(4);
    expect(seen.every((t) => t === "lanes")).toBe(true);
    await listener.unlisten();
  });

  it("keeps people outside the brand out", async () => {
    const { brand, lanes } = await teamBrand();
    await expect(listLanes(stranger, brand.id)).rejects.toThrow();
    await expect(claimLane(stranger, lanes[0].id)).rejects.toThrow();
    await expect(addLaneTask(stranger, lanes[0].id, "Sneak in")).rejects.toThrow();
  });
});
