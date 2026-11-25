/**
 * One pass of the job worker, shared by the long-running worker (`src/worker/index.ts`) and the
 * serverless tick (`/api/internal/tick`, called by cron and by `wakeWorker()` via `after()`).
 *
 * Claims agent jobs one at a time (FOR UPDATE SKIP LOCKED, so concurrent ticks and workers are safe)
 * and runs them until none are left or the time budget is spent. A job is never started once the
 * budget is spent; the next tick picks it up. A job whose worker died mid-run (lease expired) is claimed
 * again, up to MAX_AGENT_ATTEMPTS; after that it goes to the ops queue as failed.
 */
import { runJob } from "@/lib/jobs/runner";
import { claimNextAgentJob, failAbandonedAgentJobs } from "@/lib/services/jobs";
import { cleanupExpired } from "@/lib/oauth";
import { reportError } from "@/lib/monitoring";

// Daily sweep, piggybacked on a tick that already touched the database so it never wakes Neon by itself.
const CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

async function maybeCleanup() {
  if (Date.now() - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = Date.now();
  try {
    await cleanupExpired();
    console.log("[worker] cleanup done");
  } catch (err) {
    console.error("[worker] cleanup failed", err);
    reportError(err);
  }
}

export type TickResult = { ran: number; budgetSpent: boolean };

/**
 * Run claimed jobs until the queue is empty or `budgetMs` has passed.
 * `maxJobs` caps a single pass (the long-running worker passes 1 so it can check for shutdown between jobs).
 */
export async function runTick({ budgetMs = Infinity, maxJobs = Infinity }: { budgetMs?: number; maxJobs?: number } = {}): Promise<TickResult> {
  const started = Date.now();
  let ran = 0;
  const abandoned = await failAbandonedAgentJobs();
  if (abandoned) console.log(`[worker] ${abandoned} interrupted job(s) sent to ops`);
  while (ran < maxJobs) {
    if (Date.now() - started >= budgetMs) return { ran, budgetSpent: true };
    const job = await claimNextAgentJob();
    await maybeCleanup();
    if (!job) break;
    await runJob(job);
    ran++;
  }
  return { ran, budgetSpent: false };
}
