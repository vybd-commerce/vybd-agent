import { describe, expect, it } from "vitest";
import type { BriefFields } from "@/lib/brief";
import { computeBrandScore, type ScoreInput } from "@/lib/score";

const FULL: BriefFields = {
  oneLiner: "Refillable scalp oil for thinning hair",
  customer: "Women in their 40s who noticed thinning after pregnancy and want something gentler than minoxidil",
  problem: "Treatments feel medical and harsh",
  alternative: "Minoxidil foam or nothing",
  positioning: "A ritual, not a prescription",
  competitors: ["Vegamour", "Nutrafol"],
  price: "$38 per kit",
  channels: ["Shopify store"],
  goals: "First 100 orders by March",
  nameDirections: ["Rootwell", "Crown Oil", "Halo"],
  openQuestions: ["Glass or aluminium bottle?"],
};

const base: ScoreInput = { fields: {}, sharePublished: false, snapshot: null, responses: 0, yes: 0, members: 1 };
const quest = (input: ScoreInput, key: string) => computeBrandScore(input).quests.find((q) => q.key === key)!;

describe("brand score", () => {
  it("starts at zero with the brief as the next quest", () => {
    const s = computeBrandScore(base);
    expect(s.score).toBe(0);
    expect(s.next?.key).toBe("fill_brief");
    expect(s.unlocked).toBe(false);
    expect(s.quests.reduce((n, q) => n + q.points, 0)).toBe(100);
  });

  it("gives partial credit for a half-filled brief and short customer", () => {
    const s = computeBrandScore({ ...base, fields: { oneLiner: "x", customer: "busy moms", problem: "y", positioning: "z" } });
    expect(quest({ ...base, fields: { oneLiner: "x", customer: "busy moms", problem: "y", positioning: "z" } }, "fill_brief").progress).toBe(4 / 11);
    expect(s.quests.find((q) => q.key === "name_customer")!.done).toBe(false);
    expect(s.score).toBe(Math.round((20 * 4) / 11 + (5 * 2) / 12));
  });

  it("caps at 70 without real-world validation, so the bar can't be met by typing", () => {
    const s = computeBrandScore({
      ...base,
      fields: FULL,
      sharePublished: true,
      snapshot: { priceBand: { low: 30, high: 45 } },
      members: 2,
    });
    expect(s.score).toBe(70);
    expect(s.gateMet).toBe(false);
    expect(s.unlocked).toBe(false);
    expect(s.next?.key).toBe("ten_answers");
  });

  it("needs both the score and the gate to unlock", () => {
    const strong = { ...base, fields: FULL, sharePublished: true, snapshot: { priceBand: { low: 30, high: 45 } }, members: 2 };
    expect(computeBrandScore({ ...strong, responses: 10, yes: 3 }).unlocked).toBe(true);
    expect(computeBrandScore({ ...strong, responses: 10, yes: 2 }).unlocked).toBe(false);
    // Gate met but score short: solo founder with a thin brief.
    const thin = computeBrandScore({ ...base, fields: { oneLiner: "x" }, sharePublished: true, responses: 12, yes: 5 });
    expect(thin.gateMet).toBe(true);
    expect(thin.unlocked).toBe(false);
  });

  it("checks the price against the snapshot band, or accepts a stated reason", () => {
    const band = { priceBand: { low: 20, high: 30 } };
    expect(quest({ ...base, fields: { price: "$25" }, snapshot: band }, "price_check").done).toBe(true);
    expect(quest({ ...base, fields: { price: "$60" }, snapshot: band }, "price_check").done).toBe(false);
    expect(quest({ ...base, fields: { price: "$60", positioning: "Premium refill ritual" }, snapshot: band }, "price_check").done).toBe(true);
    expect(quest({ ...base, fields: { price: "$25" } }, "price_check").detail).toBe("Needs a snapshot");
  });
});
