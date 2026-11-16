import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the client across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
// Neon's pooled endpoint (PgBouncer, transaction mode) can't keep prepared statements.
const pooled = /-pooler\./.test(url);
export const sql = globalForDb.pg ?? postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? (pooled ? 5 : 10)),
    prepare: !pooled,
    idle_timeout: 20,
    // Timestamps are stored without a zone; pin the session to UTC so now() and JS Dates agree.
    connection: { TimeZone: "UTC" },
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };
