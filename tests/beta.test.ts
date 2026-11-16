import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { approveWaitlist, canSignIn, joinWaitlist } from "@/lib/services/beta";
import { createBrand } from "@/lib/services/brands";
import type { Ctx } from "@/lib/services/context";
import { getOrCreateInvite } from "@/lib/services/invites";

const stamp = Date.now();
let owner: Ctx;
const operator: Ctx = { userId: "", role: "operator" };

beforeAll(async () => {
  const [u, op] = await db
    .insert(schema.users)
    .values([{ email: `owner-${stamp}@test.dev` }, { email: `op-${stamp}@test.dev`, role: "operator" }])
    .returning();
  owner = { userId: u.id, role: "user" };
  operator.userId = op.id;
});

afterEach(() => {
  delete process.env.BETA_ALLOWLIST;
  delete process.env.BETA_GATE;
});

afterAll(async () => {
  await sql.end();
});

describe("beta gate", () => {
  it("lets in allowlisted emails and domains, case-insensitively", async () => {
    process.env.BETA_ALLOWLIST = "Ana@Example.com, @friends.dev";
    expect(await canSignIn("ana@example.com")).toBe(true);
    expect(await canSignIn("anyone@FRIENDS.dev")).toBe(true);
    expect(await canSignIn(`stranger-${stamp}@example.com`)).toBe(false);
  });

  it("lets in existing accounts", async () => {
    expect(await canSignIn(`OWNER-${stamp}@test.dev`)).toBe(true);
  });

  it("holds waitlisted people until an operator approves them", async () => {
    const email = `wait-${stamp}@test.dev`;
    await joinWaitlist(email, "Wait");
    await joinWaitlist(email, "Wait"); // second attempt is a no-op
    expect(await canSignIn(email)).toBe(false);
    await expect(approveWaitlist(owner, email)).rejects.toThrow();
    await approveWaitlist(operator, email);
    expect(await canSignIn(email)).toBe(true);
  });

  it("lets in anyone holding a live invite, but not an expired or revoked one", async () => {
    const brand = await createBrand(owner, {});
    const invite = await getOrCreateInvite(owner, brand.id);
    const token = invite.url.split("/").pop()!;
    const email = `invitee-${stamp}@test.dev`;
    expect(await canSignIn(email, token)).toBe(true);
    expect(await canSignIn(email, "nope")).toBe(false);

    await db.update(schema.invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invites.token, token));
    expect(await canSignIn(email, token)).toBe(false);
    await db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() })
      .where(eq(schema.invites.token, token));
    expect(await canSignIn(email, token)).toBe(false);
  });

  it("is open to everyone with BETA_GATE=off", async () => {
    process.env.BETA_GATE = "off";
    expect(await canSignIn(`stranger-${stamp}@example.com`)).toBe(true);
  });
});
