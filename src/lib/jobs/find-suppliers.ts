import { z } from "zod";
import { PRICES } from "./prices";
import type { JobTypeDef } from "./types";

export const suppliersSpecSchema = z.object({
  products: z.array(z.string()).min(1).describe("Products to source, e.g. ['Hair oil 50ml', 'Scalp serum 30ml']."),
  materials: z.string().default("").describe("Formulation or materials requirements."),
  moq: z.string().default("").describe("Max minimum order quantity the founder can handle, e.g. '500 units'."),
  targetUnitCost: z.string().default("").describe("Target landed cost per unit, e.g. '$6'."),
  regions: z.array(z.string()).default([]).describe("Preferred manufacturing regions."),
  mustHaves: z
    .array(z.string())
    .default([])
    .describe("e.g. 'Private label', 'GMP certified', 'US-ready labels'."),
  notes: z.string().default(""),
});
export type SuppliersSpec = z.infer<typeof suppliersSpecSchema>;

const supplierSchema = z.object({
  name: z.string().min(1),
  location: z.string().default(""),
  contact: z.string().min(1).describe("Contact person, email or phone."),
  moq: z.string().min(1),
  unitPrice: z.string().min(1),
  leadTime: z.string().min(1),
  sampleCost: z.string().min(1),
  url: z.string().default(""),
  notes: z.string().default("").describe("Operator's vetting notes."),
});

export const suppliersResultSchema = z.object({
  suppliers: z.array(supplierSchema).min(3).max(5),
  summary: z.string().default(""),
});
export type SuppliersResult = z.infer<typeof suppliersResultSchema>;

export const findSuppliers: JobTypeDef<SuppliersSpec, SuppliersResult> = {
  type: "find_suppliers",
  title: "Find suppliers",
  deliverable: "3–5 vetted suppliers with contact, MOQ, unit price, lead time and sample cost",
  fulfiller: "operator",
  fulfillerLabel: "Vybd sourcing operator",
  specSchema: suppliersSpecSchema as z.ZodType<SuppliersSpec>,
  resultSchema: suppliersResultSchema as z.ZodType<SuppliersResult>,
  draftSpec: (brief) =>
    suppliersSpecSchema.parse({
      products: [brief.oneLiner || "Core product"],
      regions: ["US", "China"],
      mustHaves: ["Private label", "US-ready labels"],
      targetUnitCost: "",
      notes: brief.positioning ? `Positioning: ${brief.positioning}` : "",
    }),
  quote: () => PRICES.find_suppliers,
  steps: [
    { key: "spec", label: "Spec drafted" },
    { key: "approval", label: "Awaiting approval" },
    { key: "assigned", label: "Operator assigned" },
    { key: "vetting", label: "Quotes collected and vetted" },
    { key: "delivered", label: "Shortlist delivered" },
  ],
  // Steps a status has completed; the next step shows as current.
  statusStep: { quoted: "spec", approved: "approval", in_progress: "approval", delivered: "delivered", accepted: "delivered" },
  deliveryForm: {
    listKey: "suppliers",
    listLabel: "Suppliers",
    minItems: 3,
    maxItems: 5,
    itemFields: [
      { key: "name", label: "Name" },
      { key: "location", label: "Location" },
      { key: "contact", label: "Contact" },
      { key: "moq", label: "MOQ" },
      { key: "unitPrice", label: "Unit price" },
      { key: "leadTime", label: "Lead time" },
      { key: "sampleCost", label: "Sample cost" },
      { key: "url", label: "Link", type: "url" },
      { key: "notes", label: "Operator notes", type: "textarea" },
    ],
    extraFields: [{ key: "summary", label: "Summary for the founder", type: "textarea" }],
  },
  summarize: (result) => ({
    content: `Your supplier shortlist is in: ${result.suppliers.length} vetted suppliers.${
      result.summary ? `\n\n${result.summary}` : ""
    }\n\nOpen the Jobs tab to see contacts, MOQs, unit prices and sample costs.`,
  }),
  stageOnDelivery: "source",
};
