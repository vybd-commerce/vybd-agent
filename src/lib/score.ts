import { BRIEF_FIELDS, type BriefFields, isFilled, parsePrice } from "@/lib/brief";

/**
 * Brand Score: 0–100 from quests that teach the habits that make a brand real. Pure and derived;
 * nothing here is stored. Reaching the bar (UNLOCK_SCORE plus the validation gate) earns a
 * 24h Autopilot run.
 */

export const UNLOCK_SCORE = 80;
export const GATE_RESPONSES = 10;
export const GATE_YES = 3;
const SPECIFIC_CUSTOMER_WORDS = 12;
const NAME_OPTIONS = 3;

export type ScoreInput = {
  fields: BriefFields;
  sharePublished: boolean;
  /** Latest market snapshot that has a result (delivered or accepted), if any. */
  snapshot: { priceBand: { low: number; high: number } } | null;
  /** Responses that count: one per responder, team answers excluded. */
  responses: number;
  yes: number;
  members: number;
};

export type QuestKey =
  | "fill_brief"
  | "name_customer"
  | "price_number"
  | "name_options"
  | "know_market"
  | "price_check"
  | "go_public"
  | "ten_answers"
  | "three_yes"
  | "cofounder";

export type Quest = {
  key: QuestKey;
  title: string;
  points: number;
  /** 0–1. Points earned are points × progress. */
  progress: number;
  done: boolean;
  /** Short status, e.g. "6 of 10". */
  detail: string;
  /** One line on why this matters, so the score teaches instead of just counting. */
  why: string;
  /** What the action chip sends to the agent. Null when the action happens outside chat. */
  prompt: string | null;
  /** UI actions the workspace handles itself instead of sending a prompt. */
  action?: "invite" | "share";
};

export type BrandScore = {
  score: number;
  quests: Quest[];
  /** At least GATE_RESPONSES answers and GATE_YES "would buy". Required to unlock. */
  gateMet: boolean;
  unlocked: boolean;
  next: Quest | null;
};

const wordCount = (s: unknown) => (typeof s === "string" ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Words that show the founder priced outside the band on purpose.
const PRICE_REASON = /\b(premium|luxury|high[- ]end|budget|affordable|value|cheaper|undercut|priced? (above|below)|price point)\b/i;

export function computeBrandScore(input: ScoreInput): BrandScore {
  const f = input.fields;
  const filled = BRIEF_FIELDS.filter((k) => isFilled(f[k])).length;
  const userPrice = parsePrice(typeof f.price === "string" ? f.price : undefined);
  const band = input.snapshot?.priceBand;
  const inBand = band != null && userPrice != null && userPrice >= band.low && userPrice <= band.high;
  const explained = PRICE_REASON.test(`${f.positioning ?? ""} ${f.price ?? ""}`);
  const names = Array.isArray(f.nameDirections) ? f.nameDirections.length : 0;
  const customerWords = wordCount(f.customer);

  const raw: Omit<Quest, "done">[] = [
    {
      key: "fill_brief",
      title: "Fill the brief",
      points: 20,
      progress: filled / BRIEF_FIELDS.length,
      detail: `${filled} of ${BRIEF_FIELDS.length} fields`,
      why: "A brand is a set of decisions, not a vibe. Every empty field is a decision you haven't made yet.",
      prompt: "What's missing from my brief? Let's fill it in.",
    },
    {
      key: "name_customer",
      title: "Name your customer",
      points: 5,
      progress: clamp01(customerWords / SPECIFIC_CUSTOMER_WORDS),
      detail: customerWords >= SPECIFIC_CUSTOMER_WORDS ? "Specific" : `${customerWords} of ${SPECIFIC_CUSTOMER_WORDS} words`,
      why: "“Everyone” buys nothing. Describe one person and the moment they need you.",
      prompt: "Help me make my customer more specific: who they are and the moment they need this.",
    },
    {
      key: "price_number",
      title: "Put a number on it",
      points: 5,
      progress: userPrice != null ? 1 : 0,
      detail: userPrice != null ? `$${userPrice}` : "No price yet",
      why: "Price is positioning. It decides who you're for before they read a word.",
      prompt: "Help me pick a target price.",
    },
    {
      key: "name_options",
      title: "Have options",
      points: 5,
      progress: clamp01(names / NAME_OPTIONS),
      detail: `${names} of ${NAME_OPTIONS} names`,
      why: "The first name is rarely the best one. Compare a few before you fall in love.",
      prompt: "Give me a few more name directions to compare.",
    },
    {
      key: "know_market",
      title: "Know your market",
      points: 15,
      progress: input.snapshot ? 1 : 0,
      detail: input.snapshot ? "Snapshot in" : "Not run",
      why: "You're never the only one. Knowing who else sells this tells you where the gap is.",
      prompt: "Let's run a market snapshot.",
    },
    {
      key: "price_check",
      title: "Price reality check",
      points: 5,
      progress: band && (inBand || explained) ? 1 : 0,
      detail: !band ? "Needs a snapshot" : inBand ? "Inside the band" : explained ? "Outside, with a reason" : "Outside the band",
      why: "Prices outside what the market pays need a reason the customer can see.",
      prompt: "Is my price right for this market? Compare it with the snapshot's price band.",
    },
    {
      key: "go_public",
      title: "Go public",
      points: 5,
      progress: input.sharePublished ? 1 : 0,
      detail: input.sharePublished ? "Page live" : "Not published",
      why: "Ideas get better in daylight. A public page turns opinions into data.",
      prompt: null,
      action: "share",
    },
    {
      key: "ten_answers",
      title: `${GATE_RESPONSES} honest answers`,
      points: 15,
      progress: clamp01(input.responses / GATE_RESPONSES),
      detail: `${Math.min(input.responses, GATE_RESPONSES)} of ${GATE_RESPONSES}`,
      why: "Friends are polite; strangers aren't. Ten answers from people who owe you nothing beat a hundred likes.",
      prompt: "Who should I send my feedback page to, and what should I say?",
      action: "share",
    },
    {
      key: "three_yes",
      title: `${GATE_YES} would buy`,
      points: 15,
      progress: clamp01(input.yes / GATE_YES),
      detail: `${Math.min(input.yes, GATE_YES)} of ${GATE_YES}`,
      why: "Intent is the only signal that counts. If no one says yes, change the brief, not the audience.",
      prompt: "Look at my feedback so far. What should I change to get more people to say yes?",
    },
    {
      key: "cofounder",
      title: "Bring a cofounder",
      points: 10,
      progress: input.members > 1 ? 1 : 0,
      detail: input.members > 1 ? `${input.members} on the team` : "Solo",
      why: "Brands are team sports. Most survive the first month because someone else showed up.",
      prompt: null,
      action: "invite",
    },
  ];

  const quests = raw.map((q) => ({ ...q, done: q.progress >= 1 }));
  const score = Math.round(quests.reduce((sum, q) => sum + q.points * q.progress, 0));
  const gateMet = input.responses >= GATE_RESPONSES && input.yes >= GATE_YES;
  return {
    score,
    quests,
    gateMet,
    unlocked: gateMet && score >= UNLOCK_SCORE,
    next: quests.find((q) => !q.done) ?? null,
  };
}
