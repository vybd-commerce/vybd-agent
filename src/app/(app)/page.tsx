import { redirect } from "next/navigation";
import { listBrands, createBrand } from "@/lib/services/brands";
import { requireCtx } from "@/lib/session";

/** Land on the most recent brand, or a fresh empty one for new users. */
export default async function Home() {
  const ctx = await requireCtx("/");
  const brands = await listBrands(ctx);
  const brand = brands[0] ?? (await createBrand(ctx, {}));
  redirect(`/brands/${brand.id}`);
}
