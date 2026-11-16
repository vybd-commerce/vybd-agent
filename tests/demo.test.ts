import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema, sql } from "@/db";
import { runDemoTurn } from "@/lib/demo/chat";
import { createBrand } from "@/lib/services/brands";
import { getBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { runTool } from "@/lib/tools";
import { resetFakeBuilder } from "@/lib/builder/client";

let ctx: Ctx;

beforeAll(async () => {
  process.env.BUILDER_MODE = "fake";
  resetFakeBuilder();
  const [u] = await db.insert(schema.users).values({ email: `demo-${Date.now()}@test.dev` }).returning();
  ctx = { userId: u.id, role: "user" };
});

afterAll(async () => {
  delete process.env.BUILDER_MODE;
  await sql.end();
});

describe("demo interview", () => {
  it("fills the whole brief by tapping the first chip each turn, then offers next steps", async () => {
    const brand = await createBrand(ctx, { name: "Demo" });
    let chips: string[] = ["A refillable scalp oil for women with thinning hair"];
    let nextSteps: string[] = [];
    for (let turn = 0; turn < 12 && chips.length; turn++) {
      const answer = chips[0];
      chips = [];
      await runDemoTurn({
        ctx,
        brandId: brand.id,
        text: answer,
        say: async () => {},
        call: async (name, input) => {
          if (name === "suggest_replies") chips = (input.chips as string[]).filter((c) => c !== "Run brand research");
          else if (name === "suggest_next_steps") nextSteps = input.steps as string[];
          else return runTool(name, { ...input, brandId: brand.id }, { ctx, surface: "web" });
        },
      });
    }
    const brief = await getBrandBrief(ctx, brand.id);
    expect(brief.fields.oneLiner).toMatch(/scalp oil/);
    expect(brief.fields.channels).toEqual(["Shopify store", "Instagram"]);
    expect(brief.fields.nameDirections).toEqual(["Rootwell", "Halo", "Crown Oil"]);
    expect(brief.pending).toEqual([]);
    expect(nextSteps).toContain("market_snapshot");
  });
});
