import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db, schema, sql } from "@/db";
import { createMcpServer } from "@/lib/mcp/server";
import { latestConversation } from "@/lib/services/conversations";
import { eq } from "drizzle-orm";

let client: Client;
let userId: string;

const text = (res: Awaited<ReturnType<Client["callTool"]>>) => (res.content as { text: string }[]).at(-1)!.text;

async function activity(brandId: string) {
  const conv = await latestConversation(brandId, "web");
  if (!conv) return [];
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
  return rows.filter((m) => m.attachments.mcpActivity);
}

beforeAll(async () => {
  const [u] = await db.insert(schema.users).values({ email: `mcp-${Date.now()}@test.dev` }).returning();
  userId = u.id;
  const server = createMcpServer({ userId: u.id, role: "user" }, { clientName: "Claude Code" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await sql.end();
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
