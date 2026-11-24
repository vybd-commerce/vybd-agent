import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { createMcpServer } from "@/lib/mcp/server";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { latestConversation } from "@/lib/services/conversations";
import { acceptInvite, getOrCreateInvite } from "@/lib/services/invites";
import { listLanes, type Lane, type LaneTask } from "@/lib/services/lanes";

let client: Client;
let userId: string;
const clients: Client[] = [];

const text = (res: Awaited<ReturnType<Client["callTool"]>>) => (res.content as { text: string }[]).at(-1)!.text;

async function activity(brandId: string) {
  const conv = await latestConversation(brandId, "web");
  if (!conv) return [];
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
  return rows.filter((m) => m.attachments.mcpActivity);
}

async function connect(ctx: Ctx, clientName?: string) {
  const server = createMcpServer(ctx, { clientName });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

beforeAll(async () => {
  const [u] = await db.insert(schema.users).values({ email: `mcp-${Date.now()}@test.dev` }).returning();
  userId = u.id;
  client = await connect({ userId, role: "user" }, "Claude Code");
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await sql.end();
});

describe("MCP lane tools", () => {
  let owner: Ctx;
  let member: Ctx;
  let founder: Client;
  let teammate: Client;
  let outsider: Client;

  beforeAll(async () => {
    const users = await db.insert(schema.users).values(
      ["owner", "member", "outsider"].map((name) => ({ email: `mcp-lanes-${name}-${randomUUID()}@test.dev` })),
    ).returning();
    const contexts = users.map((user): Ctx => ({ userId: user.id, role: "user" }));
    [owner, member] = contexts;
    [founder, teammate, outsider] = await Promise.all(contexts.map((ctx) => connect(ctx)));
  });

  async function teamBrand() {
    const brand = await createBrand(owner, { name: "MCP lanes" });
    const { token } = await getOrCreateInvite(owner, brand.id);
    await acceptInvite(member, token);
    return { brandId: brand.id, lanes: await listLanes(owner, brand.id) };
  }

  async function success<T>(client: Client, name: string, args: Record<string, unknown>, headline: string): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const blocks = result.content as { type: string; text: string }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: headline });
    expect(blocks[1].type).toBe("text");
    return JSON.parse(blocks[1].text) as T;
  }

  async function failure(client: Client, name: string, args: Record<string, unknown>, message: string) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(message) }]);
  }

  it("registers each lane tool exactly once", async () => {
    const { tools } = await teammate.listTools();
    for (const name of ["list_lanes", "claim_lane", "release_lane", "add_task", "update_task"]) {
      const matches = tools.filter((tool) => tool.name === name);
      expect(matches).toHaveLength(1);
      expect(matches[0].inputSchema.required).toContain("brandId");
    }
  });

  it("lists the ordered lanes and checklists only for an accessible brand", async () => {
    const { brandId, lanes } = await teamBrand();
    const listed = await success<(Lane & { tasks: LaneTask[] })[]>(teammate, "list_lanes", { brandId }, "4 lanes, 0 claimed.");
    expect(listed.map((lane) => lane.title)).toEqual(["Positioning", "Research", "Product", "Sourcing"]);
    expect(listed.map((lane) => lane.id)).toEqual(lanes.map((lane) => lane.id));
    expect(listed.every((lane) => lane.ownerId === null && lane.tasks.length === 0)).toBe(true);
    await failure(outsider, "list_lanes", { brandId }, "Not your brand");
    await failure(teammate, "list_lanes", { brandId: "invalid" }, "brandId");
  });

  it("claims a lane as the caller and preserves a claim against a competing teammate", async () => {
    const { brandId, lanes } = await teamBrand();
    const args = { brandId, laneId: lanes[1].id };
    const claimed = await success<Lane>(teammate, "claim_lane", args, "You own the Research lane.");
    expect(claimed).toMatchObject({ id: args.laneId, brandId, ownerId: member.userId });
    expect(await success<Lane>(teammate, "claim_lane", args, "You own the Research lane.")).toEqual(claimed);
    await failure(founder, "claim_lane", args, "Someone else already owns this lane");
    expect((await listLanes(owner, brandId))[1].ownerId).toBe(member.userId);
  });

  it("logs successful lane mutations in the brand thread and leaves reads silent", async () => {
    const { brandId, lanes } = await teamBrand();
    const upperBrandId = brandId.toUpperCase();
    const args = { brandId: upperBrandId, laneId: lanes[1].id };
    await success(teammate, "list_lanes", { brandId }, "4 lanes, 0 claimed.");
    expect(await activity(brandId)).toHaveLength(0);

    await success(teammate, "claim_lane", args, "You own the Research lane.");
    expect(await activity(brandId)).toMatchObject([{
      role: "system",
      authorId: member.userId,
      content: "Claimed the Research lane",
      attachments: { mcpActivity: { tool: "claim_lane", client: "an AI agent" } },
    }]);

    const task = await success<LaneTask>(teammate, "add_task", { ...args, title: "Review\nsamples" }, "Added “Review samples”.");
    const update = { brandId: upperBrandId, taskId: task.id };
    await success(teammate, "update_task", { ...update, done: true }, "Marked “Review samples” complete.");
    await success(teammate, "update_task", { ...update, done: false }, "Marked “Review samples” incomplete.");
    await success(teammate, "release_lane", args, "The Research lane is unassigned.");

    const entries = await activity(brandId);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => [entry.attachments.mcpActivity?.tool, entry.content])).toEqual(expect.arrayContaining([
      ["claim_lane", "Claimed the Research lane"],
      ["add_task", "Added task “Review samples”"],
      ["update_task", "Marked “Review samples” complete"],
      ["update_task", "Marked “Review samples” incomplete"],
      ["release_lane", "Released the Research lane"],
    ]));
  });

  it("releases lanes as the lane owner or brand owner", async () => {
    const { brandId, lanes } = await teamBrand();
    const args = { brandId, laneId: lanes[1].id };
    const headline = "The Research lane is unassigned.";
    await success(founder, "claim_lane", args, "You own the Research lane.");
    await failure(teammate, "release_lane", args, "Only the lane owner or the brand owner");
    expect(await success<Lane>(founder, "release_lane", args, headline)).toMatchObject({ ownerId: null });
    await success(teammate, "claim_lane", args, "You own the Research lane.");
    expect(await success<Lane>(teammate, "release_lane", args, headline)).toMatchObject({ ownerId: null });
    await success(teammate, "claim_lane", args, "You own the Research lane.");
    await success(founder, "release_lane", args, headline);
    await success(teammate, "release_lane", args, headline);
    expect((await listLanes(owner, brandId))[1].ownerId).toBeNull();
  });

  it("appends validated tasks as a teammate on an unassigned lane", async () => {
    const { brandId, lanes } = await teamBrand();
    const args = { brandId, laneId: lanes[3].id };
    const first = await success<LaneTask>(teammate, "add_task", { ...args, title: "  Shortlist\nsuppliers " }, "Added “Shortlist suppliers”.");
    expect(first).toMatchObject({ laneId: args.laneId, title: "Shortlist\nsuppliers", position: 0, done: false, doneBy: null });
    const second = await success<LaneTask>(teammate, "add_task", { ...args, title: "Ask for samples" }, "Added “Ask for samples”.");
    expect(second.position).toBe(1);
    await failure(teammate, "add_task", { ...args, title: "   " }, "title");
    await failure(teammate, "add_task", { ...args, title: "x".repeat(201) }, "title");
    await failure(teammate, "add_task", { ...args, laneId: "invalid", title: "Hidden" }, "laneId");
    await failure(outsider, "add_task", { ...args, title: "Hidden" }, "Not your brand");
    expect((await listLanes(owner, brandId))[3].tasks.map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it("only lets the lane owner complete and reopen a task", async () => {
    const { brandId, lanes } = await teamBrand();
    const args = { brandId, laneId: lanes[1].id };
    await success(teammate, "claim_lane", args, "You own the Research lane.");
    const task = await success<LaneTask>(founder, "add_task", { ...args, title: "Interview buyers" }, "Added “Interview buyers”.");
    const update = { brandId, taskId: task.id, done: true };
    await failure(founder, "update_task", update, "Only the lane owner");
    await failure(teammate, "update_task", { ...update, done: "true" }, "done");
    expect(await success<LaneTask>(teammate, "update_task", update, "Marked “Interview buyers” complete."))
      .toMatchObject({ id: task.id, done: true, doneBy: member.userId });
    const listed = await success<(Lane & { tasks: LaneTask[] })[]>(founder, "list_lanes", { brandId }, "4 lanes, 1 claimed.");
    expect(listed[1].tasks).toMatchObject([{ id: task.id, done: true, doneBy: member.userId }]);
    expect(await success<LaneTask>(teammate, "update_task", { ...update, done: false }, "Marked “Interview buyers” incomplete."))
      .toMatchObject({ id: task.id, done: false, doneBy: null });
    expect((await listLanes(owner, brandId))[1].tasks).toMatchObject([{ id: task.id, done: false, doneBy: null }]);
  });

  it("accepts an uppercase brand UUID for all four lane mutations", async () => {
    const { brandId, lanes } = await teamBrand();
    const upperBrandId = brandId.toUpperCase();
    const laneId = lanes[1].id;
    const args = { brandId: upperBrandId, laneId };

    expect(await success<Lane>(teammate, "claim_lane", args, "You own the Research lane."))
      .toMatchObject({ id: laneId, brandId, ownerId: member.userId });
    const task = await success<LaneTask>(teammate, "add_task", { ...args, title: "Interview buyers" }, "Added “Interview buyers”.");
    expect(task).toMatchObject({ laneId, done: false });
    expect(await success<LaneTask>(teammate, "update_task", { brandId: upperBrandId, taskId: task.id, done: true }, "Marked “Interview buyers” complete."))
      .toMatchObject({ id: task.id, done: true, doneBy: member.userId });
    expect(await success<Lane>(teammate, "release_lane", args, "The Research lane is unassigned."))
      .toMatchObject({ id: laneId, ownerId: null });
    expect((await listLanes(owner, brandId))[1]).toMatchObject({
      ownerId: null,
      tasks: [{ id: task.id, done: true, doneBy: member.userId }],
    });
  });

  it("refuses all four mutations against targets from a different brand the same caller belongs to", async () => {
    const { brandId } = await teamBrand();
    const wrongBrandId = brandId.toUpperCase();
    const other = await teamBrand();
    const laneId = other.lanes[1].id;
    await success(teammate, "claim_lane", { brandId: other.brandId, laneId }, "You own the Research lane.");
    const task = await success<LaneTask>(teammate, "add_task", { brandId: other.brandId, laneId, title: "Original task" }, "Added “Original task”.");
    const activityCount = (await activity(other.brandId)).length;

    await failure(teammate, "claim_lane", { brandId: wrongBrandId, laneId: other.lanes[0].id }, "Lane not found");
    await failure(teammate, "release_lane", { brandId: wrongBrandId, laneId }, "Lane not found");
    await failure(teammate, "add_task", { brandId: wrongBrandId, laneId, title: "Wrong brand" }, "Lane not found");
    await failure(teammate, "update_task", { brandId: wrongBrandId, taskId: task.id, done: true }, "Task not found");
    expect(await activity(brandId)).toHaveLength(0);
    expect(await activity(other.brandId)).toHaveLength(activityCount);
    const current = await listLanes(owner, other.brandId);
    expect(current[0].ownerId).toBeNull();
    expect(current[1]).toMatchObject({ ownerId: member.userId, tasks: [{ id: task.id, done: false }] });
  });
});

describe("MCP server", () => {
  it("exposes the host-run tool and the slash-command prompts", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("submit_job_result");
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["start_brand_interview", "brand_status", "run_market_snapshot"]));
  });

  it("leads tool output with a readable line", async () => {
    const created = await client.callTool({ name: "create_brand", arguments: { name: "Rootwell" } });
    const [first, json] = created.content as { type: string; text: string }[];
    expect(first.text).toMatch(/^Created Rootwell\. Open it: http:\/\/localhost:3000\/brands\//);
    expect(JSON.parse(json.text).name).toBe("Rootwell");
    const listed = await client.callTool({ name: "list_brands", arguments: {} });
    expect((listed.content as { text: string }[])[0].text).toBe("1 brand: Rootwell (brief)");
  });

  it("logs state-changing calls to the brand thread with user, client and summary", async () => {
    const brand = JSON.parse(text(await client.callTool({ name: "create_brand", arguments: { name: "Loomlight" } })));
    await client.callTool({
      name: "update_brand_brief",
      arguments: { brandId: brand.id, fields: { oneLiner: "Lamps woven from reclaimed rope", customer: "Renters" } },
    });
    const entries = await activity(brand.id);
    expect(entries.map((m) => m.content)).toEqual(["Created the brand Loomlight", "Updated the brief: One-liner, Customer"]);
    for (const m of entries) {
      expect(m.role).toBe("system");
      expect(m.authorId).toBe(userId);
      expect(m.attachments.mcpActivity?.client).toBe("Claude Code");
    }
  });

  it("does not log read-only calls or brief updates that change nothing", async () => {
    const brand = JSON.parse(text(await client.callTool({ name: "create_brand", arguments: { name: "Quietfield" } })));
    await client.callTool({ name: "update_brand_brief", arguments: { brandId: brand.id, fields: { price: "$40" } } });
    const before = (await activity(brand.id)).length;
    await client.callTool({ name: "list_brands", arguments: {} });
    await client.callTool({ name: "get_brand_brief", arguments: { brandId: brand.id } });
    await client.callTool({ name: "list_jobs", arguments: { brandId: brand.id } });
    await client.callTool({ name: "update_brand_brief", arguments: { brandId: brand.id, fields: { price: "$40" } } });
    expect((await activity(brand.id)).length).toBe(before);
  });

  it("logs job calls under the job's brand, and publishing the share page", async () => {
    const brand = JSON.parse(text(await client.callTool({ name: "create_brand", arguments: { name: "Tidewell" } })));
    await client.callTool({
      name: "update_brand_brief",
      arguments: { brandId: brand.id, fields: { oneLiner: "Sea-salt soap", customer: "Surfers", positioning: "Reef-safe" } },
    });
    const job = JSON.parse(text(await client.callTool({ name: "quote_job", arguments: { brandId: brand.id, type: "market_snapshot" } })));
    await client.callTool({ name: "approve_job", arguments: { jobId: job.id } });
    await client.callTool({ name: "create_share_page", arguments: { brandId: brand.id } });
    const summaries = (await activity(brand.id)).map((m) => m.content);
    expect(summaries).toContain(`Quoted ${job.title} · ${job.price}`);
    expect(summaries.some((s) => s.startsWith(`Approved ${job.title}`))).toBe(true);
    expect(summaries).toContain("Published the share page");
  });
});
