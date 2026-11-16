import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BriefFields } from "@/lib/brief";
import { type BrandScore, computeBrandScore, UNLOCK_SCORE } from "@/lib/score";
import { postToBrand } from "./conversations";
import { emitBrandEvent } from "./events";
import type { JobView } from "./jobs";

/** Build the score from data the brand screen and the agent already load. */
export function scoreFrom(input: {
  fields: BriefFields;
  sharePublished: boolean;
  jobs: Pick<JobView, "type" | "status" | "result" | "updatedAt">[];
  counted: { total: number; yes: number };
  members: number;
}): BrandScore {
  const snapshot = input.jobs
    .filter((j) => j.type === "market_snapshot" && (j.status === "delivered" || j.status === "accepted") && j.result)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const band = (snapshot?.result as { priceBand?: { low: number; high: number } } | null)?.priceBand;
  return computeBrandScore({
    fields: input.fields,
    sharePublished: input.sharePublished,
    snapshot: band ? { priceBand: band } : null,
    responses: input.counted.total,
    yes: input.counted.yes,
    members: input.members,
  });
}

/**
 * The first time a brand meets the bar, stamp it and celebrate in the thread. The conditional
 * update makes it happen once even when several tabs refresh at the same moment.
 */
export async function recordUnlock(brandId: string, score: BrandScore) {
  if (!score.unlocked) return false;
  const [row] = await db
    .update(schema.brands)
    .set({ scoreUnlockedAt: new Date() })
    .where(and(eq(schema.brands.id, brandId), isNull(schema.brands.scoreUnlockedAt)))
    .returning({ id: schema.brands.id });
  if (!row) return false;
  await postToBrand(brandId, {
    role: "assistant",
    content: `Brand Score ${score.score}. You cleared the bar: a filled-in brief, a read on the market, and real people saying they'd buy. That's further than most ideas ever get.\n\nYou've earned a free 24-hour Autopilot run. I'll keep working on the brand while you're away.`,
    attachments: { unlock: { score: score.score, threshold: UNLOCK_SCORE } },
  });
  await emitBrandEvent(brandId, { type: "brand" });
  return true;
}
