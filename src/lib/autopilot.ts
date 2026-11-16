// The 24h Autopilot reward: shape shared by the UI and (later) the worker that runs it.

export const AUTOPILOT_HOURS = 24;
export const AUTOPILOT_CYCLES = 8;

export type AutopilotStatus = "locked" | "available" | "active" | "done";

export type AutopilotView = {
  status: AutopilotStatus;
  startedAt?: string;
  endsAt?: string;
  cyclesRun?: number;
};

/** What a run does, in the order the sheet and the summary present it. */
export const AUTOPILOT_DUTIES = [
  { title: "Re-checks your market", detail: "Reruns the free snapshot if the brief changed." },
  { title: "Reads new feedback", detail: "Spots patterns in the answers, like price objections." },
  { title: "Proposes brief edits", detail: "As chips you accept or ignore. It never edits the brief itself." },
  { title: "Drafts extras", detail: "More name ideas, a sharper page headline, outreach messages." },
  { title: "Wraps up", detail: "One summary of everything it did, waiting for you." },
] as const;
