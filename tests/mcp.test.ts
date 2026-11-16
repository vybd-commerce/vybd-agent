import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db, schema, sql } from "@/db";
import { createMcpServer } from "@/lib/mcp/server";

let client: Client;

beforeAll(async () => {
  const [u] = await db.insert(schema.users).values({ email: `mcp-${Date.now()}@test.dev` }).returning();
  const server = createMcpServer({ userId: u.id, role: "user" });
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
});
