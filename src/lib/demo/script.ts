import type { BriefFieldKey, BriefFields } from "@/lib/brief";

/**
 * Demo mode (VYBD_DEMO=1): a scripted interview instead of a model, so the app can be shown
 * offline. The story is a refillable scalp oil; every question offers tap-to-answer chips, and a
 * chip maps to a polished brief value. Typed answers are used as written.
 */

export function demoMode() {
  return process.env.VYBD_DEMO === "1";
}

type Step = {
  field: BriefFieldKey;
  /** Reflection on the previous answer is generic; the question is specific. */
  question: string;
  chips: Record<string, string | string[]>;
};

export const DEMO_IDEA: Record<string, string> = {
  "A refillable scalp oil for women with thinning hair": "Refillable scalp oil that makes caring for thinning hair a calm daily ritual",
};

export const DEMO_STEPS: Step[] = [
  {
    field: "customer",
    question: "Who's the first person you picture buying this? Be specific about her situation.",
    chips: {
      "Women 35–50 after pregnancy": "Women 35–50 who noticed thinning after pregnancy or perimenopause and want something gentler than minoxidil",
      "Busy moms who've tried everything": "Busy mothers who have tried supplements and serums and are tired of products that feel medical",
    },
  },
  {
    field: "problem",
    question: "What's frustrating her today, in her words?",
    chips: {
      "Treatments feel harsh and clinical": "Existing treatments feel harsh, clinical and a bit embarrassing to use",
      "Nothing feels like self-care": "Nothing on the market feels like self-care; it all feels like a prescription",
    },
  },
  {
    field: "alternative",
    question: "What does she use instead right now?",
    chips: {
      "Minoxidil foam": "Minoxidil foam, or nothing at all",
      "Biotin gummies": "Biotin gummies and drugstore hair serums",
    },
  },
  {
    field: "positioning",
    question: "So why would she pick yours over those?",
    chips: {
      "A ritual, not a prescription": "A ritual, not a prescription: plant oils, a glass dropper and refills that make the routine feel good",
      "Clean ingredients, real results": "Clean, plant-based ingredients with visible results in 12 weeks",
    },
  },
  {
    field: "competitors",
    question: "Which brands would she compare you with?",
    chips: {
      "Vegamour, Nutrafol": ["Vegamour", "Nutrafol"],
      "Act+Acre, The Ordinary": ["Act+Acre", "The Ordinary"],
    },
  },
  {
    field: "price",
    question: "What would a starter kit cost?",
    chips: { "$38 per kit": "$38 starter kit, $24 refills", "$29 per kit": "$29 starter kit, $18 refills", "$55 per kit": "$55 starter kit, $32 refills" },
  },
  {
    field: "channels",
    question: "Where will you sell first?",
    chips: {
      "Shopify + Instagram": ["Shopify store", "Instagram"],
      "Shopify + Amazon": ["Shopify store", "Amazon"],
      "TikTok Shop": ["TikTok Shop"],
    },
  },
  {
    field: "goals",
    question: "What would make the next three months a win?",
    chips: {
      "First 100 orders": "First 100 orders by March",
      "Validate before inventory": "50 people say they'd buy before ordering inventory",
    },
  },
  {
    field: "nameDirections",
    question: "Last one: any name ideas? Here are a few to react to.",
    chips: {
      "Rootwell, Halo, Crown Oil": ["Rootwell", "Halo", "Crown Oil"],
      "Something softer": ["Soft Root", "Still", "Bloom Ritual"],
    },
  },
];

const ARRAY_FIELDS: BriefFieldKey[] = ["competitors", "channels", "nameDirections", "openQuestions"];

/** Turn a founder answer into the value for the field being asked. */
export function answerValue(step: Step | undefined, field: BriefFieldKey, text: string): string | string[] {
  const mapped = step?.chips[text];
  if (mapped) return mapped;
  if (ARRAY_FIELDS.includes(field)) return text.split(/,|\band\b/).map((s) => s.trim()).filter(Boolean);
  return text.trim();
}

export function stepFor(field: BriefFieldKey) {
  return DEMO_STEPS.find((s) => s.field === field);
}

export function nextStep(fields: BriefFields) {
  return DEMO_STEPS.find((s) => !fields[s.field] || (Array.isArray(fields[s.field]) && (fields[s.field] as unknown[]).length === 0));
}

export const DEMO_SNAPSHOT = {
  competitors: [
    { name: "Vegamour", url: "https://vegamour.com", kitPrice: "$58", productCount: 40, angle: "Plant-based, science-forward", sourceUrl: "https://vegamour.com" },
    { name: "Nutrafol", url: "https://nutrafol.com", kitPrice: "$88", productCount: 25, angle: "Supplements, physician-backed", sourceUrl: "https://nutrafol.com" },
    { name: "Act+Acre", url: "https://actandacre.com", kitPrice: "$48", productCount: 15, angle: "Cold-processed scalp care", sourceUrl: "https://actandacre.com" },
    { name: "The Ordinary", url: "https://theordinary.com", kitPrice: "$22", productCount: 120, angle: "Clinical, low price", sourceUrl: "https://theordinary.com" },
    { name: "Briogeo", url: "https://briogeohair.com", kitPrice: "$42", productCount: 60, angle: "Clean hair care, broad range", sourceUrl: "https://briogeohair.com" },
    { name: "Bondi Boost", url: "https://bondiboost.com", kitPrice: "$35", productCount: 30, angle: "Affordable growth line", sourceUrl: "https://bondiboost.com" },
  ],
  priceBand: { low: 22, high: 88, userPrice: null, currency: "USD" },
  openLane: "Everyone sells results or science; nobody owns the calm, refillable ritual for women in their 40s.",
  proposedEdits: [{ label: "Sharpen positioning", patch: { positioning: "The calm, refillable scalp ritual for women in their 40s" } }],
};

export const DEMO_REPORT = `# Brand research: scalp oil for thinning hair

## Market
Scalp care is one of the fastest growing hair categories in the US. Most brands lead with science and before-and-after photos; price points cluster at $40–60 for a first kit.

## Customer
Women 35–50 describe current options as "medical" and "embarrassing". They want something they would leave on the bathroom shelf, not hide in a drawer.

## Opportunities
1. **Own the ritual.** No competitor leads with the routine itself. Glass, dropper, refills.
2. **Refills as retention.** A $24 refill every six weeks gives you a subscription without calling it one.
3. **Founder story.** Thinning after pregnancy is common and rarely talked about. Say it plainly.

## Focus for the next 90 days
- Publish the share page and collect 50 "would you buy" answers.
- Order 300 units from one private-label supplier; test two scents.
- Launch on Shopify with Instagram as the only paid channel.
`;
