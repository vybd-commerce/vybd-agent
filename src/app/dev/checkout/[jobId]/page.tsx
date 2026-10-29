import { notFound, redirect } from "next/navigation";
import { formatPrice } from "@/components/format";
import { Wordmark } from "@/components/wordmark";
import { getOwnedBrand } from "@/lib/services/brands";
import { getJob, markJobPaid } from "@/lib/services/jobs";
import { requireCtx } from "@/lib/session";
import { devCheckoutAllowed } from "@/lib/stripe";

/** Stand-in for Stripe Checkout in development when no Stripe keys are set. */
export default async function DevCheckout({ params }: PageProps<"/dev/checkout/[jobId]">) {
  if (!devCheckoutAllowed()) notFound();
  const { jobId } = await params;
  const ctx = await requireCtx(`/dev/checkout/${jobId}`);
  const job = await getJob(ctx, jobId).catch(() => notFound());
  const brand = await getOwnedBrand(ctx, job.brandId);

  async function pay() {
    "use server";
    const c = await requireCtx();
    const j = await getJob(c, jobId);
    await getOwnedBrand(c, j.brandId);
    await markJobPaid(jobId, `dev_pi_${jobId}`);
    redirect(`/brands/${j.brandId}?job=${jobId}&paid=1`);
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[360px]">
        <Wordmark />
        <p className="mt-8 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">
          Test checkout. Stripe keys aren’t set, so no card is charged.
        </p>
        <h1 className="mt-6 text-[20px] font-semibold">{job.title}</h1>
        <p className="text-ink-2">{brand.name}</p>
        <p className="mt-4 font-mono text-[24px]">{formatPrice(job.priceCents)}</p>
        <form action={pay} className="mt-6 flex gap-2">
          <button className="h-10 flex-1 rounded-lg bg-accent font-medium text-white">Pay {formatPrice(job.priceCents)}</button>
          <a href={`/brands/${brand.id}?job=${job.id}`} className="h-10 rounded-lg border border-line px-4 leading-10 font-medium">
            Cancel
          </a>
        </form>
      </div>
    </main>
  );
}
