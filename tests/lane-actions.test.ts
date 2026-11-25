import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { addLaneTaskAction, claimLaneAction, releaseLaneAction, setLaneTaskDoneAction } from "@/app/actions";
import { db, schema, sql } from "@/db";
import { requireCtx } from "@/lib/session";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { acceptInvite, getOrCreateInvite } from "@/lib/services/invites";
import { listLanes } from "@/lib/services/lanes";

vi.mock(import("@/auth"), () => ({ REFERRAL_COOKIE: "vybd_ref" as const, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock(import("@/lib/session"), () => ({ requireCtx: vi.fn(), getCtx: vi.fn() }));

let owner: Ctx;
let member: Ctx;
let outsider: Ctx;
let operator: Ctx;

beforeAll(async () => {
  const users = await db.insert(schema.users).values(
    ["user", "user", "user", "operator"].map((role) => ({ email: `${randomUUID()}@test.dev`, role: role as Ctx["role"] })),
  ).returning();
  [owner, member, outsider, operator] = users.map(({ id, role }) => ({ userId: id, role }));
});

afterAll(async () => {
  await sql.end();
});

async function teamBrand() {
  const brand = await createBrand(owner, {});
  const { token } = await getOrCreateInvite(owner, brand.id);
  await acceptInvite(member, token);
  const [lane] = await listLanes(owner, brand.id);
  return { brandId: brand.id, laneId: lane.id };
}

it("applies the C1 team permissions to claim, add, complete, reopen, and release", async () => {
  const target = await teamBrand();
  vi.mocked(requireCtx).mockResolvedValue(member);
  expect(await claimLaneAction(target)).toEqual({ ok: true, data: target.laneId });

  vi.mocked(requireCtx).mockResolvedValue(owner);
  const added = await addLaneTaskAction({ ...target, title: "  Interview buyers  " });
  if (!added.ok) throw new Error(added.error);
  const task = { brandId: target.brandId, taskId: added.data };
  expect(await setLaneTaskDoneAction({ ...task, done: true })).toMatchObject({ ok: false, error: expect.stringContaining("lane owner") });

  vi.mocked(requireCtx).mockResolvedValue(member);
  expect(await setLaneTaskDoneAction({ ...task, done: true })).toEqual({ ok: true, data: task.taskId });
  expect((await listLanes(owner, target.brandId))[0].tasks[0]).toMatchObject({ title: "Interview buyers", done: true, doneBy: member.userId });
  expect(await setLaneTaskDoneAction({ ...task, done: false })).toEqual({ ok: true, data: task.taskId });

  vi.mocked(requireCtx).mockResolvedValue(owner);
  expect(await releaseLaneAction(target)).toEqual({ ok: true, data: target.laneId });
  expect((await listLanes(owner, target.brandId))[0]).toMatchObject({ ownerId: null, tasks: [{ id: task.taskId, done: false, doneBy: null }] });
});

it("denies team writes to outsiders and read-only operators and validates inputs", async () => {
  const target = await teamBrand();
  await expect(listLanes(operator, target.brandId)).resolves.toHaveLength(4);
  for (const viewer of [outsider, operator]) {
    vi.mocked(requireCtx).mockResolvedValue(viewer);
    expect(await claimLaneAction(target)).toEqual({ ok: false, error: "Not your brand" });
    expect(await addLaneTaskAction({ ...target, title: "Not allowed" })).toEqual({ ok: false, error: "Not your brand" });
  }

  vi.mocked(requireCtx).mockResolvedValue(member);
  expect(await claimLaneAction({ ...target, laneId: "bad-id" })).toMatchObject({ ok: false, error: expect.stringContaining("laneId") });
  for (const title of ["   ", "x".repeat(201)]) {
    expect(await addLaneTaskAction({ ...target, title })).toMatchObject({ ok: false, error: expect.stringContaining("title") });
  }
  expect((await listLanes(owner, target.brandId))[0]).toMatchObject({ ownerId: null, tasks: [] });
});

it("rejects all four mutations when the lane or task belongs to another brand the caller can access", async () => {
  const workspace = await teamBrand();
  const other = await teamBrand();
  vi.mocked(requireCtx).mockResolvedValue(member);
  expect(await claimLaneAction(other)).toMatchObject({ ok: true });
  const added = await addLaneTaskAction({ ...other, title: "Keep this task" });
  if (!added.ok) throw new Error(added.error);
  const baseline = await listLanes(member, other.brandId);
  const wrongBrand = { brandId: workspace.brandId, laneId: other.laneId };
  expect(await claimLaneAction({ ...wrongBrand, laneId: baseline[1].id })).toEqual({ ok: false, error: "Lane not found" });
  expect(await releaseLaneAction(wrongBrand)).toEqual({ ok: false, error: "Lane not found" });
  expect(await addLaneTaskAction({ ...wrongBrand, title: "Wrong brand" })).toEqual({ ok: false, error: "Lane not found" });
  expect(await setLaneTaskDoneAction({ brandId: workspace.brandId, taskId: added.data, done: true })).toEqual({ ok: false, error: "Task not found" });
  expect(await listLanes(member, other.brandId)).toEqual(baseline);
});
