import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isPooledUrl, resolveListenUrl } from "./listen-url";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the clients across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql; pgListen?: postgres.Sql };
// Neon's pooled endpoint (PgBouncer, transaction mode) can't keep prepared statements.
const pooled = isPooledUrl(url);
export const sql = globalForDb.pg ?? postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? (pooled ? 5 : 10)),
    prepare: !pooled,
    idle_timeout: 20,
    // Timestamps are stored without a zone; pin the session to UTC so now() and JS Dates agree.
    connection: { TimeZone: "UTC" },
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = sql;

// LISTEN needs a session-level connection, which PgBouncer's transaction mode doesn't give.
// This client only serves listen(); postgres.js opens one dedicated connection for all channels.
const listenUrl = resolveListenUrl(process.env).url;
export const listenSql = globalForDb.pgListen ?? postgres(listenUrl, {
    max: 1,
    prepare: !isPooledUrl(listenUrl),
    connection: { TimeZone: "UTC" },
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgListen = listenSql;

/** Subscribe to a NOTIFY channel over the direct connection. Use this, not sql.listen. */
export function listen(channel: string, onNotify: (payload: string) => void) {
  return listenSql.listen(channel, onNotify);
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };
