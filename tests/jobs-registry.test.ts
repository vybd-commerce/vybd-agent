import { describe, expect, it } from "vitest";
import { canTransition, jobType, reachedStepIndex } from "@/lib/jobs/registry";

describe("job state machine", () => {
  it("follows draft → quoted → approved → in_progress → delivered → accepted", () => {
    expect(canTransition("draft", "quoted")).toBe(true);
    expect(canTransition("quoted", "approved")).toBe(true);
    expect(canTransition("approved", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "delivered")).toBe(true);
    expect(canTransition("delivered", "accepted")).toBe(true);
  });

  it("rejects skipping payment or reopening finished jobs", () => {
    expect(canTransition("quoted", "in_progress")).toBe(false);
    expect(canTransition("quoted", "delivered")).toBe(false);
    expect(canTransition("accepted", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "quoted")).toBe(false);
  });
});

describe("progress steps for find_suppliers", () => {
  const def = jobType("find_suppliers");
  const label = (status: Parameters<typeof reachedStepIndex>[1], progress: string[] = []) =>
    def.steps[reachedStepIndex(def, status, progress) + 1]?.label ?? "done";

  it("shows the next step as current", () => {
    expect(label("quoted")).toBe("Awaiting approval");
    expect(label("in_progress")).toBe("Operator assigned");
    expect(label("in_progress", ["assigned"])).toBe("Quotes collected and vetted");
    expect(label("in_progress", ["assigned", "vetting"])).toBe("Shortlist delivered");
    expect(label("delivered")).toBe("done");
  });
});

describe("result validation", () => {
  it("requires 3–5 suppliers with contact and pricing", () => {
    const def = jobType("find_suppliers");
    const supplier = { name: "A", contact: "a@x.co", moq: "500", unitPrice: "$5", leadTime: "4w", sampleCost: "$80" };
    expect(def.resultSchema.safeParse({ suppliers: [supplier, supplier] }).success).toBe(false);
    expect(def.resultSchema.safeParse({ suppliers: [supplier, supplier, supplier] }).success).toBe(true);
  });

  it("requires every snapshot competitor to link to a source", () => {
    const def = jobType("market_snapshot");
    const c = { name: "X", url: "https://x.com", kitPrice: "$40", productCount: 3, angle: "clean" };
    const base = { priceBand: { low: 20, high: 60 }, openLane: "Refills" };
    expect(def.resultSchema.safeParse({ ...base, competitors: Array(5).fill(c) }).success).toBe(false);
    const sourced = { ...c, sourceUrl: "https://x.com/p" };
    expect(def.resultSchema.safeParse({ ...base, competitors: Array(5).fill(sourced) }).success).toBe(true);
  });
});
