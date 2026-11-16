import Link from "next/link";
import { approveWaitlistAction } from "@/app/actions";
import { listWaitlist } from "@/lib/services/beta";
import { requireCtx } from "@/lib/session";

export default async function OpsWaitlist({ searchParams }: PageProps<"/ops/waitlist">) {
  const ctx = await requireCtx("/ops/waitlist");
  const { show = "pending" } = await searchParams;
  const pending = show !== "all";
  const rows = await listWaitlist(ctx, { pending });

  return (
    <div>
      <h1 className="text-[24px] font-display font-normal tracking-[-0.015em]">Waitlist</h1>
      <p className="mt-1 text-ink-2">
        People who tried to sign in without beta access. Approve someone and they can sign in right away.
      </p>
      <nav className="mt-4 flex gap-1" aria-label="Filter waitlist">
        {[
          { key: "pending", label: "Pending" },
          { key: "all", label: "All" },
        ].map((f) => (
          <Link
            key={f.key}
            href={`/ops/waitlist?show=${f.key}`}
            aria-current={(f.key === "all") !== pending ? "page" : undefined}
            className={`h-8 rounded-lg px-3 text-[13px] leading-8 font-medium ${(f.key === "all") !== pending ? "bg-subtle" : "text-ink-2 hover:text-ink"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="mt-8 text-ink-2">No one waiting.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {rows.map((r) => (
            <li key={r.email} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.email}</div>
                <div className="text-[12px] text-ink-3">
                  {r.name ? `${r.name} · ` : ""}
                  {r.createdAt.toISOString().slice(0, 10)}
                </div>
              </div>
              {r.approvedAt ? (
                <span className="text-[13px] text-ink-2">Approved</span>
              ) : (
                <form action={approveWaitlistAction}>
                  <input type="hidden" name="email" value={r.email} />
                  <button className="h-8 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
                    Approve
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
