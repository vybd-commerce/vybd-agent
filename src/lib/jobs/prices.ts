// Open questions in the spec: market snapshot pricing and the Find suppliers price are undecided.
// Change them here; quotes, quote cards and Stripe all read from this table.
export const PRICES = {
  market_snapshot: { priceCents: 0, etaDays: 1 },
  find_suppliers: { priceCents: 14900, etaDays: 5 },
} as const;
