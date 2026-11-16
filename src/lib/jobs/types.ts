import type { z } from "zod";
import type { BriefFields } from "@/lib/brief";
import type { ProposedEdit } from "@/lib/types";

export type JobStatus =
  | "draft"
  | "quoted"
  | "approved"
  | "in_progress"
  | "delivered"
  | "accepted"
  | "cancelled"
  | "failed";

export type Fulfiller = "agent" | "operator" | "hybrid";

export type JobStep = { key: string; label: string };

export type DeliveryField = { key: string; label: string; type?: "text" | "number" | "url" | "textarea" };

/** Describes the form operators fill to deliver a job by hand. */
export type DeliveryForm = {
  listKey: string;
  listLabel: string;
  itemFields: DeliveryField[];
  minItems: number;
  maxItems: number;
  extraFields: DeliveryField[]; // dotted paths, e.g. "priceBand.low"
};

export type ResearchTask = {
  instructions: string;
  brief: string;
  /** JSON Schema the submitted result must match. */
  resultSchema: Record<string, unknown>;
};

export type AgentRunHelpers = {
  brandId: string;
  progress: (step: string, note: string) => Promise<void>;
  brief: BriefFields;
};

export type JobTypeDef<Spec = Record<string, unknown>, Result = Record<string, unknown>> = {
  type: string;
  title: string;
  deliverable: string;
  fulfiller: Fulfiller;
  /** Who does the work, shown on the quote card. */
  fulfillerLabel: string;
  specSchema: z.ZodType<Spec>;
  resultSchema: z.ZodType<Result>;
  draftSpec: (brief: BriefFields) => Spec;
  quote: (spec: Spec) => { priceCents: number; etaDays: number };
  /** Throws (InvalidStateError) when the brand can't take this job yet. Runs before quoting. */
  precheck?: (brandId: string) => Promise<void>;
  steps: JobStep[];
  /** Which progress step each status implies. */
  statusStep: Partial<Record<JobStatus, string>>;
  deliveryForm: DeliveryForm;
  /** Same work as `run`, handed to the founder's own assistant when there is no server-side model. */
  researchTask?: (spec: Spec) => ResearchTask;
  /** Agent part of the work. Absent for operator-only jobs. */
  run?: (spec: Spec, helpers: AgentRunHelpers) => Promise<Result>;
  /** Chat summary and proposed brief edits posted when the job is delivered. */
  summarize: (result: Result, brief: BriefFields) => { content: string; proposedEdits?: ProposedEdit[] };
  /** Stage the brand reaches once delivered. */
  stageOnDelivery?: "validate" | "source";
};
