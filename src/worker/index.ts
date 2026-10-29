/**
 * Job worker: runs the agent part of in-progress jobs. Run alongside the web app with `pnpm worker`.
 * Claims one job at a time with FOR UPDATE SKIP LOCKED, so several workers can run safely.
 */
import { describeAnthropicError } from "@/lib/anthropic";
import { latestBrief } from "@/lib/services/brief";
import { addAgentProgress, claimNextAgentJob, deliverJob, failJob, type Job } from "@/lib/services/jobs";
import { jobType } from "@/lib/jobs/registry";
import { sql } from "@/db";

const POLL_MS = 3000;
let stopping = false;

async function runJob(job: Job) {
  const def = jobType(job.type);
  if (!def.run) return; // operator-only job type; nothing for the agent to do
  console.log(`[worker] running ${job.type} ${job.id}`);
  const brief = await latestBrief(job.brandId);
  try {
    const result = await def.run(job.spec, {
      brief: brief.fields,
      progress: (step, note) => addAgentProgress(job.id, step, note),
    });
    if (def.fulfiller === "hybrid") {
      // Agent drafted it; an operator reviews and delivers from the ops console.
      await addAgentProgress(job.id, "", "Agent draft ready for operator review");
      console.log(`[ops] ${def.title} ${job.id} has an agent draft awaiting review`);
      return;
    }
    await deliverJob(job.id, result, "agent");
    console.log(`[worker] delivered ${job.id}`);
  } catch (err) {
    console.error(`[worker] job ${job.id} failed`, err);
    const reason = `${describeAnthropicError(err)} (${err instanceof Error ? err.message : String(err)})`;
    await failJob(job.id, reason.slice(0, 500)).catch((e) => console.error("[worker] could not mark failed", e));
  }
}

async function loop() {
  console.log("[worker] started");
  while (!stopping) {
    try {
      const job = await claimNextAgentJob();
      if (job) {
        await runJob(job);
        continue;
      }
    } catch (err) {
      console.error("[worker] poll failed", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await sql.end();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
  });
}

void loop();
