import { describeAnthropicError } from "@/lib/anthropic";
import { reportError } from "@/lib/monitoring";
import { syncedBrief } from "@/lib/services/brief";
import { addAgentProgress, deliverJob, failJob, releaseAgentLease, renewAgentLease, type Job } from "@/lib/services/jobs";
import { jobType } from "./registry";

const HEARTBEAT_MS = 60_000;

/** Run the agent part of one in-progress job, then deliver it (or hand a hybrid draft to ops). */
export async function runJob(job: Job) {
  const def = jobType(job.type);
  if (!def.run) return releaseAgentLease(job.id); // operator-only job type; nothing for the agent to do
  console.log(`[worker] running ${job.type} ${job.id}`);
  // Keep the claim while this process is alive; if it dies, the lease expires and another worker resumes.
  const heartbeat = setInterval(() => {
    renewAgentLease(job.id).catch((err) => console.warn("[worker] lease renewal failed", err instanceof Error ? err.message : err));
  }, HEARTBEAT_MS);
  try {
    const brief = await syncedBrief(job.brandId);
    const result = await def.run(job.spec, {
      brandId: job.brandId,
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
    reportError(err, { jobId: job.id, jobType: job.type });
    const reason = `${describeAnthropicError(err)} (${err instanceof Error ? err.message : String(err)})`;
    await failJob(job.id, reason.slice(0, 500)).catch((e) => console.error("[worker] could not mark failed", e));
  } finally {
    clearInterval(heartbeat);
    await releaseAgentLease(job.id).catch((err) => console.warn("[worker] lease release failed", err instanceof Error ? err.message : err));
  }
}
