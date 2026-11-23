/** Neon's pooled endpoint (PgBouncer, transaction mode) has "-pooler." in the host. */
export function isPooledUrl(url: string): boolean {
  return /-pooler\./.test(url);
}

/**
 * Which URL LISTEN connections should use. PgBouncer in transaction mode hands the server connection
 * back to the pool after each statement, so a LISTEN on it may never receive NOTIFYs and live updates
 * stop silently. Prefer the direct URL whenever one is configured.
 */
export function resolveListenUrl(env: Record<string, string | undefined>): {
  url: string;
  warning?: string;
} {
  const direct = env.DATABASE_URL_DIRECT?.trim();
  if (direct) return { url: direct };
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (isPooledUrl(url)) {
    return {
      url,
      warning:
        "DATABASE_URL is a pooled (-pooler) URL and DATABASE_URL_DIRECT is not set: live updates (LISTEN/NOTIFY) may not arrive. Set DATABASE_URL_DIRECT to the same URL without -pooler.",
    };
  }
  return { url };
}
