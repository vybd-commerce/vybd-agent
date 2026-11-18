import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { isUsable } from "@/lib/brief";
import { latestBrief } from "@/lib/services/brief";
import { assertNotProduction, seed, SEED_BRAND_NAME, SEED_USERS } from "../scripts/seed";

const STATUSES = ["draft", "quoted", "approved", "in_progress", "delivered", "accepted", "cancelled", "failed"] as const;

afterAll(async () => {
  await sql.end();
});

async function seedBrands() {
  const owner = await db.query.users.findFirst({ where: eq(schema.users.email, SEED_USERS.owner.email) });
  return db
    .select()
    .from(schema.brands)
    .where(and(eq(schema.brands.ownerId, owner!.id), eq(schema.brands.name, SEED_BRAND_NAME)));
}

describe("seed", () => {
  it("creates three users, a shared brand with a usable brief, and one job in each status", async () => {
    const result = await seed();

    const users = await db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.email, Object.values(SEED_USERS).map((u) => u.email)));
    expect(users).toHaveLength(3);
    expect(users.find((u) => u.email === SEED_USERS.operator.email)?.role).toBe("operator");

    const members = await db.select().from(schema.brandMembers).where(eq(schema.brandMembers.brandId, result.brandId));
    expect(members.map((m) => m.role).sort()).toEqual(["member", "owner"]);

    expect(isUsable((await latestBrief(result.brandId)).fields)).toBe(true);

    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.brandId, result.brandId));
    expect(jobs.map((j) => j.status).sort()).toEqual([...STATUSES].sort());
    for (const status of STATUSES) expect(jobs.find((j) => j.id === result.jobs[status])?.status).toBe(status);

    // Agent jobs are pre-claimed so a running worker never picks up seed work.
    const startedAgentJobs = jobs.filter((j) => j.fulfiller === "agent" && j.status !== "quoted");
    expect(startedAgentJobs.length).toBeGreaterThan(0);
    expect(startedAgentJobs.every((j) => j.agentClaimedAt)).toBe(true);
  });

  it("is safe to re-run: same users, one seed brand", async () => {
    const first = await seed();
    const second = await seed();
    expect(second.users).toEqual(first.users);
    expect(await seedBrands()).toHaveLength(1);
  });

  it("refuses to run against production", () => {
    expect(() => assertNotProduction({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertNotProduction({ RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/production/);
    expect(() => assertNotProduction({ NODE_ENV: "development" })).not.toThrow();
  });
});
