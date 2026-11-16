import { sql } from "drizzle-orm";
import { db } from "@/db";

export type RateLimitResult = { ok: boolean; retryAfter: number };

/**
 * Fixed-window counter in Postgres: one atomic upsert per call, no extra infrastructure.
 * `key` names the bucket, e.g. "register:203.0.113.4".
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const start = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${start.toISOString()}::timestamp, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(rows[0]?.count ?? 1);
  const retryAfter = Math.max(1, Math.ceil((start.getTime() + windowSec * 1000 - now) / 1000));
  return { ok: count <= limit, retryAfter };
}

/** Client IP behind Railway's proxy (first hop of x-forwarded-for). */
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

export function tooManyRequests(retryAfter: number, headers: Record<string, string> = {}) {
  return Response.json(
    { error: "rate_limited", error_description: "Too many requests. Try again shortly." },
    { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } },
  );
}
