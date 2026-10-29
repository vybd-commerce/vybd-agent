import type { BriefDiff, BriefFields } from "./brief";

export type NextStepKind = "market_snapshot" | "share_page" | "find_suppliers";

export type NextStep = { kind: NextStepKind; title: string; description: string };

export type ProposedEdit = { label: string; patch: BriefFields; applied?: boolean };

export type MessageAttachments = {
  jobRefs?: string[];
  briefDiff?: BriefDiff;
  chips?: string[];
  nextSteps?: NextStep[];
  proposedEdits?: ProposedEdit[];
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
  { kind: "market_snapshot", title: "Market snapshot", description: "Competitors, price band and the open lane." },
  { kind: "share_page", title: "Get feedback", description: "A shareable page that asks: would you buy this?" },
  { kind: "find_suppliers", title: "Find suppliers", description: "Vetted manufacturers, quoted before you pay." },
];
