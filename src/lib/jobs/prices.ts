// Open questions in the spec: market snapshot pricing and the Find suppliers price are undecided.
// Change them here; quotes, quote cards and Stripe all read from this table.
export const PRICES = {
  market_snapshot: { priceCents: 0, etaDays: 1 },
  find_suppliers: { priceCents: 14900, etaDays: 5 },
  // Brand Builder research run. Free while it runs on free models; revisit once search is real.
  brand_research: { priceCents: 0, etaDays: 1 },
} as const;
