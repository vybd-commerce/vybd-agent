import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BrandWorkspace } from "@/components/brand-workspace";
import { getBrandState } from "@/lib/services/brand-state";
import { requireCtx } from "@/lib/session";

export default async function BrandPage({ params }: PageProps<"/brands/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx(`/brands/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const state = await getBrandState(ctx, id).catch((err) => {
    if ((err as { status?: number }).status === 404 || (err as { status?: number }).status === 403) notFound();
    throw err;
  });
  // Round-trip through JSON so dates match what the client gets from /api/brands/[id]/state.
  const initial = JSON.parse(JSON.stringify(state));
  return (
    <Suspense>
      <BrandWorkspace key={id} initial={initial} />
    </Suspense>
  );
}
