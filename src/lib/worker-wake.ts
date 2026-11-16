/**
 * Nudge the job worker so it claims new work now instead of on its next (slow) poll.
 * The slow poll lets Neon scale to zero when nothing is happening. Best effort: a failed
 * nudge only delays the job until the worker's next poll.
 */
export function wakeWorker() {
  const url = process.env.WORKER_URL;
  if (!url) return;
  void fetch(`${url.replace(/\/$/, "")}/wake`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WORKER_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(3000),
  }).catch((err) => console.warn("[worker] wake failed", err instanceof Error ? err.message : err));
}
