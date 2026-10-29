import { sql } from "@/db";

export type BrandEvent =
  | { type: "brief"; version: number; changed: string[] }
  | { type: "job"; jobId: string; status: string }
  | { type: "message"; conversationId: string }
  | { type: "brand" }
  | { type: "feedback" };

// Channel names must be identifiers; uuids contain dashes.
export function brandChannel(brandId: string) {
  return `brand_${brandId.replaceAll("-", "")}`;
}

export const OPS_CHANNEL = "ops_jobs";

/** Fan out a change to every surface subscribed to this brand (web SSE). */
export async function emitBrandEvent(brandId: string, event: BrandEvent) {
  await sql.notify(brandChannel(brandId), JSON.stringify(event));
}

export async function emitOpsEvent(event: { jobId: string; status: string }) {
  await sql.notify(OPS_CHANNEL, JSON.stringify(event));
}
