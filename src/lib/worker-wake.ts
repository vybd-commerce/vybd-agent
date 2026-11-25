import { after } from "next/server";

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
        await runTick({ budgetMs: 240_000 }).catch((err) => console.error("[worker] inline tick failed", err));
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
