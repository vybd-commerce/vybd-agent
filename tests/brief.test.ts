import { describe, expect, it } from "vitest";
import { isUsable, mergeBrief } from "@/lib/brief";

describe("mergeBrief", () => {
  it("sets new fields and reports a diff", () => {
    const { fields, diff } = mergeBrief({ oneLiner: "Scalp oil" }, { customer: "Women 30-50" });
    expect(fields).toEqual({ oneLiner: "Scalp oil", customer: "Women 30-50" });
    expect(diff).toEqual({ customer: { from: null, to: "Women 30-50" } });
  });

  it("ignores unchanged values", () => {
    const { diff } = mergeBrief({ price: "$38", channels: ["Shopify"] }, { price: "$38", channels: ["Shopify"] });
    expect(diff).toEqual({});
  });

  it("clears a field with an empty value", () => {
    const { fields, diff } = mergeBrief({ price: "$38", channels: ["Shopify"] }, { price: "", channels: [] });
    expect(fields).toEqual({});
    expect(Object.keys(diff)).toEqual(["price", "channels"]);
  });
});

describe("isUsable", () => {
  it("needs one-liner, customer and positioning", () => {
    expect(isUsable({ oneLiner: "a", customer: "b" })).toBe(false);
    expect(isUsable({ oneLiner: "a", customer: "b", positioning: "  " })).toBe(false);
    expect(isUsable({ oneLiner: "a", customer: "b", positioning: "c" })).toBe(true);
  });
});
