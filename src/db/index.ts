import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the client across hot reloads in dev.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
export const sql = globalForDb.pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { schema };
