import { z } from "zod";

// Brief schema. Every surface (web chat, jobs, MCP) reads and writes these fields. The Brand Builder
// owns the canonical copy; keys map 1:1 to its brief sections (SECTION_OF in lib/builder/client.ts).
export const BRIEF_FIELDS = [
  "oneLiner",
  "customer",
  "problem",
  "alternative",
  "positioning",
  "competitors",
  "price",
  "channels",
  "goals",
  "nameDirections",
  "openQuestions",
] as const;

export type BriefFieldKey = (typeof BRIEF_FIELDS)[number];

export const briefFieldsSchema = z
  .object({
    oneLiner: z.string().describe("One sentence: what the brand sells and to whom."),
    customer: z.string().describe("Who buys it. Be specific about the person and situation."),
    problem: z.string().describe("The problem or desire the product addresses."),
    alternative: z.string().describe("What the customer uses or does today instead."),
    positioning: z.string().describe("How it is different from what the customer buys today."),
    competitors: z.array(z.string()).describe("Named brands the customer would compare it with."),
    price: z.string().describe("Target retail price or range, e.g. '$38 per kit'."),
    channels: z.array(z.string()).describe("Where it will sell, e.g. ['Shopify store', 'Amazon']."),
    goals: z.string().describe("What the founder wants from the next 3 to 6 months, e.g. 'First 100 orders by March'."),
    nameDirections: z.array(z.string()).describe("Candidate brand names or naming directions."),
    openQuestions: z.array(z.string()).describe("Unresolved questions to come back to."),
  })
  .partial();

export type BriefFields = z.infer<typeof briefFieldsSchema>;

export const BRIEF_LABELS: Record<BriefFieldKey, string> = {
  oneLiner: "One-liner",
  customer: "Customer",
  problem: "Problem",
  alternative: "What they use today",
  positioning: "Positioning",
  competitors: "Competitors",
  price: "Price",
  channels: "Channels",
  goals: "Goals",
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

/** First number in a price string: "$38 per kit" -> 38. */
export function parsePrice(text: string | undefined): number | null {
  const m = text?.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}
