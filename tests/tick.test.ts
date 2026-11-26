import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/db";
import { runTick } from "@/worker/tick";

afterAll(async () => {
  await sql.end();
});

describe("runTick", () => {
  it("claims nothing once the budget is spent", async () => {
    expect(await runTick({ budgetMs: 0 })).toEqual({ ran: 0, budgetSpent: true, yielded: 0, nextWaitMs: null });
  });

  it("stops at maxJobs", async () => {
    expect(await runTick({ maxJobs: 0 })).toEqual({ ran: 0, budgetSpent: false, yielded: 0, nextWaitMs: null });
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

describe("chainTick", () => {
  const yielded = { ran: 1, budgetSpent: false, yielded: 1, nextWaitMs: 0 };

  it("starts the next tick when a job yielded, with the depth header", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("APP_URL", "https://agent.test/");
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { chainTick, TICK_DEPTH_HEADER } = await import("@/lib/worker-wake");
    expect(await chainTick(yielded, 3)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agent.test/api/internal/tick");
    expect(init.headers).toMatchObject({ authorization: "Bearer s3cret", [TICK_DEPTH_HEADER]: "4" });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does nothing without a yield, past the depth cap, or without a secret", async () => {
    vi.stubEnv("APP_URL", "https://agent.test");
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { chainTick, MAX_TICK_CHAIN } = await import("@/lib/worker-wake");
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(await chainTick({ ...yielded, yielded: 0 }, 0)).toBe(false);
    expect(await chainTick(yielded, MAX_TICK_CHAIN)).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    expect(await chainTick(yielded, 0)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
