// Usage: pnpm backfill-builder
// Links every brand to the Brand Builder and copies its current brief there. Safe to re-run.
import { isNull } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { builderEnabled } from "@/lib/builder/client";
import { ensureBuilderBrand } from "@/lib/services/builder-sync";

async function main() {
  if (!builderEnabled()) {
    console.error("Set BUILDER_API_URL and BUILDER_SERVICE_TOKEN first.");
    process.exit(1);
  }
  const brands = await db.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands).where(isNull(schema.brands.builderBrandId));
  let failed = 0;
  for (const b of brands) {
    try {
      const { builderBrandId } = await ensureBuilderBrand(b.id);
      console.log(`${b.name} -> ${builderBrandId}`);
    } catch (err) {
      failed++;
      console.error(`${b.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Linked ${brands.length - failed} of ${brands.length} brands.`);
  await sql.end();
}

void main();
