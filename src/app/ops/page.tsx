import Link from "next/link";
import { formatPrice } from "@/components/format";
import type { JobStatus } from "@/lib/jobs/types";
import { listOpsJobs } from "@/lib/services/jobs";
import { requireCtx } from "@/lib/session";

const FILTERS: { key: string; label: string; status?: JobStatus[]; mine?: boolean }[] = [
  { key: "open", label: "Needs work", status: ["in_progress", "failed"] },
  { key: "mine", label: "Mine", mine: true, status: ["in_progress", "failed", "delivered"] },
  { key: "quoted", label: "Quoted", status: ["quoted"] },
  { key: "delivered", label: "Delivered", status: ["delivered", "accepted"] },
  { key: "all", label: "All" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  draft: "Draft",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  delivered: "Delivered",
  accepted: "Accepted",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default async function OpsQueue({ searchParams }: PageProps<"/ops">) {
  const ctx = await requireCtx("/ops");
  const { filter = "open" } = await searchParams;
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const jobs = await listOpsJobs(ctx, { status: active.status, mine: active.mine });

  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Jobs</h1>
      <nav className="mt-4 flex flex-wrap gap-1" aria-label="Filter jobs">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/ops?filter=${f.key}`}
            aria-current={f.key === active.key ? "page" : undefined}
            className={`h-8 rounded-lg px-3 text-[13px] leading-8 font-medium ${f.key === active.key ? "bg-subtle" : "text-ink-2 hover:text-ink"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {jobs.length === 0 ? (
        <p className="mt-8 text-ink-2">Nothing here. New paid jobs show up in Needs work as soon as the founder pays.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="text-[12px] text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Job</th>
                <th className="py-2 font-normal">Brand</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Operator</th>
                <th className="py-2 font-normal">Price</th>
                <th className="py-2 font-normal">Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-line">
                  <td className="py-2.5">
                    <Link href={`/ops/jobs/${j.id}`} className="font-medium text-accent hover:underline">
                      {j.title}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    {j.brandName}
                    <span className="block text-[12px] text-ink-3">{j.ownerEmail}</span>
                  </td>
                  <td className="py-2.5">{STATUS_LABEL[j.status]}</td>
                  <td className="py-2.5 text-ink-2">{j.operatorId ? (j.operatorId === ctx.userId ? "You" : "Claimed") : "Unclaimed"}</td>
                  <td className="py-2.5 font-mono text-[12px]">{formatPrice(j.priceCents)}</td>
                  <td className="py-2.5 font-mono text-[12px] text-ink-3">{j.updatedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
