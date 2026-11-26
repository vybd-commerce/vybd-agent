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

/**
 * `yielded`: jobs that handed themselves back to wait (JobYield). `nextWaitMs`: the shortest such wait,
 * so the caller can chain another tick once it has passed instead of leaving the job to the next cron.
 */
export type TickResult = { ran: number; budgetSpent: boolean; yielded: number; nextWaitMs: number | null };

/** Serverless functions are killed at 300 s; a job must hand back before this, measured from tick start. */
export const TICK_HARD_LIMIT_MS = 280_000;

/**
 * Run claimed jobs until the queue is empty or `budgetMs` has passed.
 * `maxJobs` caps a single pass (the long-running worker passes 1 so it can check for shutdown between jobs).
 */
export async function runTick({
  budgetMs = Infinity,
  maxJobs = Infinity,
  hardLimitMs = Number.isFinite(budgetMs) ? TICK_HARD_LIMIT_MS : Infinity,
}: { budgetMs?: number; maxJobs?: number; hardLimitMs?: number } = {}): Promise<TickResult> {
  const started = Date.now();
  const deadlineAt = started + hardLimitMs;
  let ran = 0;
  let yielded = 0;
  let nextWaitMs: number | null = null;
  const done = (budgetSpent: boolean): TickResult => ({ ran, budgetSpent, yielded, nextWaitMs });
  const abandoned = await failAbandonedAgentJobs();
  if (abandoned) console.log(`[worker] ${abandoned} interrupted job(s) sent to ops`);
  while (ran < maxJobs) {
    if (Date.now() - started >= budgetMs) return done(true);
    const job = await claimNextAgentJob();
    await maybeCleanup();
    if (!job) break;
    const outcome = await runJob(job, { deadlineAt });
    if (outcome.yielded) {
      yielded++;
      nextWaitMs = Math.min(nextWaitMs ?? Infinity, outcome.waitMs);
    }
    ran++;
  }
  return done(false);
}
