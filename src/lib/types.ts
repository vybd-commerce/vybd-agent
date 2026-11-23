import type { BriefDiff, BriefFields } from "./brief";

export type NextStepKind = "market_snapshot" | "share_page" | "find_suppliers" | "invite";

export type NextStep = { kind: NextStepKind; title: string; description: string };

export type ProposedEdit = {
  label: string;
  patch: BriefFields;
  applied?: boolean;
  /** Brand Builder proposal behind this edit; applying it accepts the proposal there. */
  builderProposalId?: string;
};

export type MessageAttachments = {
  jobRefs?: string[];
  briefDiff?: BriefDiff;
  chips?: string[];
  nextSteps?: NextStep[];
  proposedEdits?: ProposedEdit[];
  /** Celebration card when the brand first clears the Brand Score bar. */
  unlock?: { score: number; threshold: number };
  /** Posted by an Autopilot cycle rather than a live turn. */
  autopilot?: { cycle: number; of: number };
  /** Final Autopilot message: what it did, with counts. */
  autopilotSummary?: { items: { label: string; count: number }[] };
  /** A state-changing call from someone's own agent over MCP. Content holds the one-line summary. */
  mcpActivity?: { tool: string; client: string };
  error?: string;
};

export type Stage = "brief" | "validate" | "source" | "store" | "launch";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "brief", label: "Brief" },
  { key: "validate", label: "Validate" },
  { key: "source", label: "Source" },
  { key: "store", label: "Store" },
  { key: "launch", label: "Launch" },
];

export const DEFAULT_NEXT_STEPS: NextStep[] = [
  { kind: "market_snapshot", title: "Market snapshot", description: "Competitors, prices, gaps · ~10 min" },
  { kind: "share_page", title: "Get feedback", description: "Share a page, collect “would you buy this?”" },
  { kind: "find_suppliers", title: "Find suppliers", description: "Vetted manufacturers · quote first" },
  { kind: "invite", title: "Invite a friend", description: "Build it together in one thread" },
];
