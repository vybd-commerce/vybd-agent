/**
 * Error reporting. Sentry when SENTRY_DSN is set; otherwise errors only go to the logs.
 * Server-side only (Next.js server via instrumentation.ts, and the worker).
 */
import * as Sentry from "@sentry/node";

let started = false;

export function initMonitoring(service: "web" | "worker") {
  if (started || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV,
    initialScope: { tags: { service } },
    tracesSampleRate: 0,
  });
  started = true;
}

export function reportError(err: unknown, extra?: Record<string, unknown>) {
  if (!started) return;
  Sentry.captureException(err, extra ? { extra } : undefined);
}

export async function flushMonitoring() {
  if (started) await Sentry.flush(2000);
}
