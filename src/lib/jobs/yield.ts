/**
 * Thrown by a job's `run` to hand the job back without finishing it: the worker releases the claim
 * (not counted as an interrupted attempt) and the job is claimed again after `waitMs`. Long waits on
 * other services use this so no single serverless invocation runs past its time limit. Save whatever
 * the job needs to resume with `helpers.saveState` first.
 */
export class JobYield extends Error {
  constructor(
    public readonly waitMs: number,
    reason = "waiting",
  ) {
    super(`Job yielded: ${reason}`);
    this.name = "JobYield";
  }
}
