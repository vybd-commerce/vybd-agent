import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { GET as getBrandStateResponse } from "@/app/api/brands/[id]/state/route";
import { db, schema, sql } from "@/db";
import { getCtx } from "@/lib/session";
import { getBrandState } from "@/lib/services/brand-state";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { acceptInvite, getOrCreateInvite } from "@/lib/services/invites";
import { addLaneTask, claimLane, listLanes, setLaneTaskDone } from "@/lib/services/lanes";

vi.mock(import("@/lib/session"), () => ({ getCtx: vi.fn() }));

afterAll(async () => {
  await sql.end();
});

it("serves the ordered team and checklist state on initial load and after a teammate changes it", async () => {
  const [owner, member, outsider] = (await db.insert(schema.users).values(
    ["Owner", "Teammate", "Outsider"].map((name) => ({ name, email: `${randomUUID()}@test.dev` })),
  ).returning()).map((user): Ctx => ({ userId: user.id, role: "user" }));
  const brand = await createBrand(owner, { name: "Team state" });
  const { token } = await getOrCreateInvite(owner, brand.id);
  await acceptInvite(member, token);
  const lanes = await listLanes(member, brand.id);

  const initial = await getBrandState(owner, brand.id);
  expect(initial.members).toEqual([
    { userId: owner.userId, name: "Owner", image: null, role: "owner" },
    { userId: member.userId, name: "Teammate", image: null, role: "member" },
  ]);
  expect(initial.lanes).toEqual(lanes.map(({ id, title }) => ({ id, title, ownerId: null, tasks: [] })));
  expect(initial.lanes.map(({ title }) => title)).toEqual(["Positioning", "Research", "Product", "Sourcing"]);

  const research = lanes[1];
  await claimLane(member, research.id, brand.id);
  const interview = await addLaneTask(owner, research.id, "Interview buyers", brand.id);
  const notes = await addLaneTask(member, research.id, "Summarize findings", brand.id);
  await setLaneTaskDone(member, interview.id, true, brand.id);

  const request = new Request(`http://localhost/api/brands/${brand.id}/state`);
  const route = { params: Promise.resolve({ id: brand.id }) };
  for (const viewer of [owner, member]) {
    vi.mocked(getCtx).mockResolvedValue(viewer);
    const response = await getBrandStateResponse(request, route);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      viewerId: viewer.userId,
      members: initial.members,
      lanes: initial.lanes.map((lane) => lane.id === research.id ? {
        ...lane,
        ownerId: member.userId,
        tasks: [{ id: interview.id, title: "Interview buyers", done: true }, { id: notes.id, title: "Summarize findings", done: false }],
      } : lane),
    });
  }

  vi.mocked(getCtx).mockResolvedValue(outsider);
  expect((await getBrandStateResponse(request, route)).status).toBe(403);
  vi.mocked(getCtx).mockResolvedValue(null);
  expect((await getBrandStateResponse(request, route)).status).toBe(401);
});
