import { redirect } from "next/navigation";
import { listBrands } from "@/lib/services/brands";
import { requireCtx } from "@/lib/session";

/** Land on the most recent brand. New users start at /connect: their assistant creates the first brand. */
export default async function Home() {
  const ctx = await requireCtx("/");
  const brands = await listBrands(ctx);
  redirect(brands[0] ? `/brands/${brands[0].id}` : "/connect");
}
