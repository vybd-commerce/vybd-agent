import { findSuppliers } from "./find-suppliers";
import { marketSnapshot } from "./market-snapshot";
import type { JobStatus, JobTypeDef } from "./types";

export const JOB_TYPES = {
  market_snapshot: marketSnapshot,
  find_suppliers: findSuppliers,
} as unknown as Record<string, JobTypeDef>;

export type JobTypeKey = "market_snapshot" | "find_suppliers";
export const JOB_TYPE_KEYS = Object.keys(JOB_TYPES) as JobTypeKey[];

export function jobType(type: string): JobTypeDef {
  const def = JOB_TYPES[type];
  if (!def) throw new Error(`Unknown job type: ${type}`);
  return def;
}

// The job state machine. Every status change goes through services/jobs.ts#transition.
export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ["quoted", "cancelled"],
  quoted: ["quoted", "approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["delivered", "failed", "cancelled"],
  delivered: ["accepted", "in_progress"],
  accepted: [],
  cancelled: [],
  failed: ["in_progress", "cancelled"],
};

export function canTransition(from: JobStatus, to: JobStatus) {
  return TRANSITIONS[from].includes(to);
}

/**
 * Index of the last completed step, from status and progress events. Steps up to it render as done;
 * the next one renders as current.
 */
export function reachedStepIndex(
  def: Pick<JobTypeDef, "steps" | "statusStep">,
  status: JobStatus,
  progressSteps: string[],
): number {
  const idx = (key?: string) => (key ? def.steps.findIndex((s) => s.key === key) : -1);
  let current = idx(def.statusStep[status]);
  for (const step of progressSteps) current = Math.max(current, idx(step));
  return current;
}
