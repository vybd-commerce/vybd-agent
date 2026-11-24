import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db, schema, sql } from "@/db";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { getOrCreateInvite } from "@/lib/services/invites";
import { addLaneTask, claimLane, listLanes, setLaneTaskDone } from "@/lib/services/lanes";
import { myWork } from "@/lib/services/my-work";
import { createMcpServer } from "@/lib/mcp/server";

let owner: Ctx;
let friend: Ctx;

beforeAll(async () => {
  const stamp = Date.now();
  const [a, b] = await db
    .insert(schema.users)
    .values([
      { email: `mw-owner-${stamp}@test.dev`, name: "Owner" },
      { email: `mw-friend-${stamp}@test.dev`, name: "Priya" },
    ])
    .returning();
  owner = { userId: a.id, role: "user" };
  friend = { userId: b.id, role: "user" };
});

afterAll(async () => {
  await sql.end();
});

async function connect(ctx: Ctx) {
  const server = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("accept_invite and my_tasks", () => {
  it("joins from an invite URL over MCP, then shows owned lanes and open tasks across brands", async () => {
    const brand = await createBrand(owner, { name: "Rootwell" });
    const { url } = await getOrCreateInvite(owner, brand.id);

    const client = await connect(friend);
    const joined = await client.callTool({ name: "accept_invite", arguments: { invite: url } });
    expect((joined.content as { text: string }[])[0].text).toBe("Joined the brand.");

    const empty = await myWork(friend);
    expect(empty.lanes).toEqual([]);
    expect(empty.unowned.map((l) => l.lane)).toEqual(["Positioning", "Research", "Product", "Sourcing"]);

    const sourcing = (await listLanes(friend, brand.id)).find((l) => l.key === "sourcing")!;
    await claimLane(friend, sourcing.id);
    const t1 = await addLaneTask(owner, sourcing.id, "Get 3 bottle quotes");
    await addLaneTask(owner, sourcing.id, "Order samples");
    await setLaneTaskDone(friend, t1.id, true);

    const work = await myWork(friend);
    expect(work.lanes).toHaveLength(1);
    expect(work.lanes[0]).toMatchObject({ brand: "Rootwell", lane: "Sourcing" });
    expect(work.lanes[0].tasks.map((t) => t.title)).toEqual(["Order samples"]);
    expect((await myWork(friend, { includeDone: true })).lanes[0].tasks).toHaveLength(2);
    expect(work.unowned).toHaveLength(3);

    const res = await client.callTool({ name: "my_tasks", arguments: {} });
    expect((res.content as { text: string }[])[0].text).toBe("1 lane, 1 open task · 3 unowned lanes.");
    await client.close();
  });

  it("rejects a bad invite", async () => {
    const client = await connect(friend);
    const res = await client.callTool({ name: "accept_invite", arguments: { invite: "nope" } });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
