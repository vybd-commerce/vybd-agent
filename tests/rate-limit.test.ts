import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/db";
import { rateLimit } from "@/lib/rate-limit";

afterAll(async () => {
  vi.useRealTimers();
  await sql.end();
});

describe("rate limit", () => {
  it("trips after the limit and resets in the next window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).ok).toBe(true);
    const blocked = await rateLimit(key, 3, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(55);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect((await rateLimit(key, 3, 60)).ok).toBe(true);
  });
});
