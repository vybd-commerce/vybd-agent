import type { BriefFieldKey, BriefFields } from "@/lib/brief";
import { getBrandBrief } from "@/lib/services/brief";
import type { Ctx } from "@/lib/services/context";
import { answerValue, DEMO_IDEA, nextStep, stepFor } from "./script";

/**
 * One scripted chat turn. `say` streams text; `call` runs a tool through the normal orchestrator
 * path, so brief updates, quote cards and chips render exactly as with a model.
 */
export async function runDemoTurn(opts: {
  ctx: Ctx;
  brandId: string;
  text: string;
  say: (text: string) => Promise<void>;
  call: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}) {
  const { ctx, brandId, say, call } = opts;
  const text = opts.text.trim();
  const lower = text.toLowerCase();

  const quote = async (type: string, line: string) => {
    await say(line);
    await call("quote_job", { type });
  };
  if (/snapshot/.test(lower)) return quote("market_snapshot", "On it. Here's the quote: it's free and usually done in a minute.");
  if (/research/.test(lower)) return quote("brand_research", "Good call. Our research agents will work through the whole brief. Here's the quote.");
  if (/supplier/.test(lower)) return quote("find_suppliers", "A Vybd sourcing operator will vet 3 to 5 private-label suppliers. Here's the quote.");
  if (/share page|feedback/.test(lower)) {
    await call("create_share_page", {});
    await say("Your share page is live. Send it to ten people who fit your customer and ask them one thing: would you buy this?");
    return;
  }

  const brief = await getBrandBrief(ctx, brandId);
  const asked = brief.pending[0] as BriefFieldKey | undefined;
  const patch: BriefFields = {};
  if (asked) Object.assign(patch, { [asked]: answerValue(stepFor(asked), asked, text) });
  else if (!brief.fields.oneLiner) patch.oneLiner = DEMO_IDEA[text] ?? text;

  const next = nextStep({ ...brief.fields, ...patch });
  if (Object.keys(patch).length) {
    await say(patch.oneLiner ? "Love it. I've started your brief on the right. " : "Got it. ");
    await call("update_brand_brief", { fields: patch, asking: next ? [next.field] : [] });
  }
  if (next) {
    await say(next.question);
    await call("suggest_replies", { chips: Object.keys(next.chips) });
    return;
  }
  await say(
    "That's a complete brief. Next I'd check the market: a snapshot shows who you're up against and where your price sits. Or run full brand research.",
  );
  await call("suggest_next_steps", { steps: ["market_snapshot", "share_page", "find_suppliers"] });
  await call("suggest_replies", { chips: ["Run brand research"] });
}
