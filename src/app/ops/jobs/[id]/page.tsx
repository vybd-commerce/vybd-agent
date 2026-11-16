import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEta, formatPrice, jobStatusLine } from "@/components/format";
import { SpecView } from "@/components/jobs-tab";
import { OpsJobActions } from "@/components/ops-job-actions";
import { ProgressList } from "@/components/progress-list";
import { BRIEF_FIELDS, BRIEF_LABELS, formatValue } from "@/lib/brief";
import { jobType } from "@/lib/jobs/registry";
import { getBrand } from "@/lib/services/brands";
import { latestBrief } from "@/lib/services/brief";
import { getJob } from "@/lib/services/jobs";
import { requireCtx } from "@/lib/session";

export default async function OpsJobPage({ params }: PageProps<"/ops/jobs/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx(`/ops/jobs/${id}`);
  const job = await getJob(ctx, id).catch(() => notFound());
  const [brand, brief] = await Promise.all([getBrand(ctx, job.brandId), latestBrief(job.brandId)]);
  const def = jobType(job.type);
  const finished = job.status === "delivered" || job.status === "accepted";
  const view = JSON.parse(JSON.stringify(job));

  return (
    <div>
      <Link href="/ops" className="text-[13px] text-ink-2 hover:text-ink">
        ‹ All jobs
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-display font-normal tracking-[-0.015em]">
            {job.title} for {brand.name}
          </h1>
          <p className="font-mono text-[12px] text-ink-3">
            {jobStatusLine(job)} · {formatPrice(job.priceCents)} · {formatEta(job.etaDays)} · {job.id.slice(0, 8)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-8">
          <OpsJobActions
            job={view}
            isMine={job.operatorId === ctx.userId}
            deliveryForm={def.deliveryForm}
            steps={def.steps}
          />
        </div>
        <aside className="space-y-6">
          <section>
            <p className="mb-2 text-[12px] text-ink-3">Progress</p>
            <ProgressList steps={job.steps} reached={job.reachedStep} finished={finished} />
          </section>
          <section>
            <p className="mb-2 text-[12px] text-ink-3">Spec</p>
            <SpecView spec={job.spec} />
          </section>
          <section>
            <p className="mb-2 text-[12px] text-ink-3">Brand brief v{brief.version}</p>
            <dl className="space-y-2">
              {BRIEF_FIELDS.filter((k) => formatValue(brief.fields[k])).map((k) => (
                <div key={k}>
                  <dt className="text-[12px] text-ink-3">{BRIEF_LABELS[k]}</dt>
                  <dd>{formatValue(brief.fields[k])}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <p className="mb-2 text-[12px] text-ink-3">Activity</p>
            <ol className="space-y-1.5 font-mono text-[11px] text-ink-2">
              {job.events.map((e) => (
                <li key={e.id}>
                  <span className="text-ink-3">{new Date(e.createdAt).toISOString().slice(5, 16).replace("T", " ")}</span>{" "}
                  {e.actor} · {e.kind === "status" ? `${e.payload.from ?? "new"} → ${e.payload.to}` : String(e.payload.note ?? e.payload.text ?? e.kind)}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
