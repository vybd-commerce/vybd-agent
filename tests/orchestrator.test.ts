import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db, schema, sql } from "@/db";
import { runChatTurn, type ChatEvent } from "@/lib/agent/orchestrator";
import { streamCompletion } from "@/lib/openrouter";
import { createBrand } from "@/lib/services/brands";
import { ensureConversation } from "@/lib/services/conversations";
import { listLanes } from "@/lib/services/lanes";

vi.mock(import("@/lib/openrouter"), async (importOriginal) => ({
  ...await importOriginal(),
  chatProvider: () => "openrouter",
  streamCompletion: vi.fn(),
}));

afterAll(async () => {
  await sql.end();
});

it("exposes lane tools in web chat and uses the active brand for tool calls", async () => {
  const [user] = await db.insert(schema.users).values({ email: `web-lanes-${randomUUID()}@test.dev` }).returning();
  const ctx = { userId: user.id, role: "user" as const };
  const active = await createBrand(ctx, { name: "Active brand" });
  const other = await createBrand(ctx, { name: "Other brand" });
  const conversation = await ensureConversation(ctx, active.id, "web");
  if (!conversation) throw new Error("Could not create the test conversation");
  const [activeLane] = await listLanes(ctx, active.id);
  const [otherLane] = await listLanes(ctx, other.id);

  const complete = vi.mocked(streamCompletion);
  complete.mockResolvedValueOnce({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [
      { id: "list", type: "function", function: { name: "list_lanes", arguments: "{}" } },
      { id: "claim", type: "function", function: { name: "claim_lane", arguments: JSON.stringify({ laneId: activeLane.id }) } },
      {
        id: "wrong-brand",
        type: "function",
        function: { name: "claim_lane", arguments: JSON.stringify({ brandId: other.id, laneId: otherLane.id }) },
      },
    ],
  });
  complete.mockImplementationOnce(async (_input, onText) => {
    onText("The Positioning lane is yours.");
    return { content: "The Positioning lane is yours.", finishReason: "stop", toolCalls: [] };
  });

  const events: ChatEvent[] = [];
  await runChatTurn({
    ctx,
    brandId: active.id,
    conversationId: conversation.id,
    text: "Show my lanes and claim Positioning.",
    emit: (event) => events.push(event),
  });

  expect(complete).toHaveBeenCalledTimes(2);
  const [{ tools }] = complete.mock.calls[0];
  const schemas = {
    list_lanes: [],
    claim_lane: ["laneId"],
    release_lane: ["laneId"],
    add_task: ["laneId", "title"],
    update_task: ["taskId", "done"],
  };
  for (const [name, properties] of Object.entries(schemas)) {
    const matches = tools.filter((tool) => tool.function.name === name);
    expect(matches).toHaveLength(1);
    const input = matches[0].function.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(input.properties)).toEqual(properties);
    expect(input.required ?? []).toEqual(properties);
  }

  const [{ messages }] = complete.mock.calls[1];
  const [list, claim, rejected] = messages.filter((message) => message.role === "tool");
  const [listHeadline, ...listJson] = list.content.split("\n");
  expect(listHeadline).toBe("4 lanes, 0 claimed.");
  expect(JSON.parse(listJson.join("\n"))[0]).toMatchObject({ id: activeLane.id, brandId: active.id });
  const [claimHeadline, ...claimJson] = claim.content.split("\n");
  expect(claimHeadline).toBe("You own the Positioning lane.");
  expect(JSON.parse(claimJson.join("\n"))).toMatchObject({ id: activeLane.id, brandId: active.id, ownerId: user.id });
  expect(rejected.content).toBe("Error: Lane not found");
  expect((await listLanes(ctx, active.id))[0].ownerId).toBe(user.id);
  expect((await listLanes(ctx, other.id))[0].ownerId).toBeNull();
  expect(events.at(-1)).toMatchObject({ type: "done" });
});
