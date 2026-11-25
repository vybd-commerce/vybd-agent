import { timingSafeEqual } from "node:crypto";
import { reportError } from "@/lib/monitoring";
import { runTick } from "@/worker/tick";

// Vercel Hobby caps functions at 300 s. runTick stops claiming new jobs after TICK_BUDGET_MS.
export const maxDuration = 300;
const TICK_BUDGET_MS = 240_000;

function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serverless job worker. Called by the external cron (fallback, every 15 min) so jobs still run on
 * hosts without a long-running worker process. `wakeWorker()` runs the same tick in-process with `after()`.
 */
export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  try {
    const result = await runTick({ budgetMs: TICK_BUDGET_MS });
    if (result.ran) console.log("[worker] tick", result);
    return Response.json(result);
  } catch (err) {
    console.error("[worker] tick failed", err);
    reportError(err);
    return Response.json({ error: { code: "tick_failed", message: "Tick failed" } }, { status: 500 });
  }
}
