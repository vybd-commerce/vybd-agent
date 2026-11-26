import { after } from "next/server";
import type { TickResult } from "@/worker/tick";

/** Header carrying how many ticks in a row have chained; capped so a stuck job can't loop forever. */
export const TICK_DEPTH_HEADER = "x-vybd-tick-depth";
export const MAX_TICK_CHAIN = 20;
const MAX_CHAIN_WAIT_MS = 30_000;

function tickUrl() {
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  return base ? `${base.replace(/\/$/, "")}/api/internal/tick` : null;
}

/**
 * After a tick in which a job yielded (it is waiting on another service, e.g. a Brand Builder run),
 * start the next tick once the wait is over rather than leaving the job to the 15-minute cron.
 * Fire and forget: the next tick runs in its own invocation; we only wait for it to be accepted.
 */
export async function chainTick(result: TickResult, depth: number) {
  if (!result.yielded || depth >= MAX_TICK_CHAIN) return false;
  const url = tickUrl();
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) return false;
  await new Promise((r) => setTimeout(r, Math.min(result.nextWaitMs ?? 0, MAX_CHAIN_WAIT_MS)));
  await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, [TICK_DEPTH_HEADER]: String(depth + 1) },
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    // A timeout only means the next tick is still running, which is the point.
    if (!(err instanceof Error && err.name === "TimeoutError")) console.warn("[worker] chain tick failed", err instanceof Error ? err.message : err);
  });
  return true;
}

/**
 * Nudge the job worker so it claims new work now instead of on its next (slow) poll.
 * The slow poll lets Neon scale to zero when nothing is happening. Best effort: a failed
 * nudge only delays the job until the worker's next poll (or the next cron tick).
 *
 * WORKER_INLINE=1 (serverless hosts such as Vercel): run the tick in this function after the
 * response is sent. Otherwise POST /wake on the long-running worker (WORKER_URL).
 */
export function wakeWorker() {
  if (process.env.WORKER_INLINE === "1") {
    try {
      after(async () => {
        const { runTick } = await import("@/worker/tick");
        const result = await runTick({ budgetMs: 240_000 }).catch((err) => {
          console.error("[worker] inline tick failed", err);
          return null;
        });
        if (result) await chainTick(result, 0);
      });
    } catch (err) {
      // Called outside a request (script, test): the cron tick picks the job up.
      console.warn("[worker] inline wake skipped", err instanceof Error ? err.message : err);
    }
    return;
  }
  const url = process.env.WORKER_URL;
  if (!url) return;
  void fetch(`${url.replace(/\/$/, "")}/wake`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WORKER_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(3000),
  }).catch((err) => console.warn("[worker] wake failed", err instanceof Error ? err.message : err));
}
