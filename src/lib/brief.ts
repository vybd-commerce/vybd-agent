import { z } from "zod";

// Frozen v1 brief schema. Every surface (web chat, jobs, MCP) reads and writes these fields.
export const BRIEF_FIELDS = [
  "oneLiner",
  "customer",
  "problem",
  "positioning",
  "price",
  "channels",
  "nameDirections",
  "openQuestions",
] as const;

export type BriefFieldKey = (typeof BRIEF_FIELDS)[number];

export const briefFieldsSchema = z
  .object({
    oneLiner: z.string().describe("One sentence: what the brand sells and to whom."),
    customer: z.string().describe("Who buys it. Be specific about the person and situation."),
    problem: z.string().describe("The problem or desire the product addresses."),
    positioning: z.string().describe("How it is different from what the customer buys today."),
    price: z.string().describe("Target retail price or range, e.g. '$38 per kit'."),
    channels: z.array(z.string()).describe("Where it will sell, e.g. ['Shopify store', 'Amazon']."),
    nameDirections: z.array(z.string()).describe("Candidate brand names or naming directions."),
    openQuestions: z.array(z.string()).describe("Unresolved questions to come back to."),
  })
  .partial();

export type BriefFields = z.infer<typeof briefFieldsSchema>;

export const BRIEF_LABELS: Record<BriefFieldKey, string> = {
  oneLiner: "One-liner",
  customer: "Customer",
  problem: "Problem",
  positioning: "Positioning",
  price: "Price",
  channels: "Channels",
  nameDirections: "Name directions",
  openQuestions: "Open questions",
};

export const REQUIRED_FOR_USABLE: BriefFieldKey[] = ["oneLiner", "customer", "positioning"];

export function isFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

export function isUsable(fields: BriefFields): boolean {
  return REQUIRED_FOR_USABLE.every((k) => isFilled(fields[k]));
}

export type BriefDiff = Partial<Record<BriefFieldKey, { from: unknown; to: unknown }>>;

/** Merge a patch into fields. Empty string / empty array clears a field. Returns new fields and the diff. */
export function mergeBrief(current: BriefFields, patch: BriefFields): { fields: BriefFields; diff: BriefDiff } {
  const fields: BriefFields = { ...current };
  const diff: BriefDiff = {};
  for (const key of BRIEF_FIELDS) {
    if (!(key in patch)) continue;
    const next = patch[key];
    if (next === undefined) continue;
    const prev = current[key];
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    diff[key] = { from: prev ?? null, to: next };
    if (isFilled(next)) {
      (fields as Record<string, unknown>)[key] = next;
    } else {
      delete fields[key];
    }
  }
  return { fields, diff };
}

export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}
