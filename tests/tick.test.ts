import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/db";
import { runTick } from "@/worker/tick";

afterAll(async () => {
  await sql.end();
});

describe("runTick", () => {
  it("claims nothing once the budget is spent", async () => {
    expect(await runTick({ budgetMs: 0 })).toEqual({ ran: 0, budgetSpent: true });
  });

  it("stops at maxJobs", async () => {
    expect(await runTick({ maxJobs: 0 })).toEqual({ ran: 0, budgetSpent: false });
  });
});

describe("POST /api/internal/tick", () => {
  const call = async (auth?: string) => {
    const { POST } = await import("@/app/api/internal/tick/route");
    return POST(new Request("http://localhost/api/internal/tick", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  };

  it("refuses requests without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("refuses everything when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("runs a tick with the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.doMock("@/worker/tick", () => ({ runTick: vi.fn(async () => ({ ran: 0, budgetSpent: false })) }));
    vi.resetModules();
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: 0, budgetSpent: false });
    vi.doUnmock("@/worker/tick");
    vi.unstubAllEnvs();
  });
});
