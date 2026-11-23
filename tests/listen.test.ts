import { afterAll, describe, expect, it } from "vitest";
import { listen, listenSql, sql } from "@/db";
import { isPooledUrl, resolveListenUrl } from "@/db/listen-url";
import { brandChannel, emitBrandEvent } from "@/lib/services/events";

const POOLED = "postgres://u:p@ep-cool-1234-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
const DIRECT = "postgres://u:p@ep-cool-1234.us-east-2.aws.neon.tech/db?sslmode=require";

afterAll(async () => {
  await listenSql.end();
  await sql.end();
});

describe("resolveListenUrl", () => {
  it("detects Neon pooled hosts", () => {
    expect(isPooledUrl(POOLED)).toBe(true);
    expect(isPooledUrl(DIRECT)).toBe(false);
    expect(isPooledUrl("postgres://localhost:5432/vybd_agent")).toBe(false);
  });

  it("uses DATABASE_URL_DIRECT whenever it is set", () => {
    expect(resolveListenUrl({ DATABASE_URL: POOLED, DATABASE_URL_DIRECT: DIRECT })).toEqual({ url: DIRECT });
  });

  it("warns when only a pooled URL is configured", () => {
    const r = resolveListenUrl({ DATABASE_URL: POOLED, DATABASE_URL_DIRECT: "  " });
    expect(r.url).toBe(POOLED);
    expect(r.warning).toMatch(/DATABASE_URL_DIRECT/);
  });

  it("uses a plain DATABASE_URL without warning", () => {
    expect(resolveListenUrl({ DATABASE_URL: "postgres://localhost:5432/x" })).toEqual({ url: "postgres://localhost:5432/x" });
  });

  it("throws without any URL", () => {
    expect(() => resolveListenUrl({})).toThrow(/DATABASE_URL/);
  });
});

describe("listen", () => {
  it("delivers brand events emitted on the main pool", async () => {
    const brandId = crypto.randomUUID();
    const received = new Promise<string>((resolve) => {
      void listen(brandChannel(brandId), resolve).then((sub) => {
        void emitBrandEvent(brandId, { type: "brand" });
        return sub;
      });
    });
    const payload = await Promise.race([
      received,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no NOTIFY within 2s")), 2000)),
    ]);
    expect(JSON.parse(payload)).toEqual({ type: "brand" });
  });
});
