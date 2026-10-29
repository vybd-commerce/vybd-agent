import type { SnapshotResult } from "@/lib/jobs/market-snapshot";
import type { JobView } from "@/lib/services/jobs";
import type { NextStep } from "@/lib/types";
import { DEFAULT_NEXT_STEPS } from "@/lib/types";
import { NextStepCard } from "./next-step-card";
import { ProgressList } from "./progress-list";

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PriceBand({ band }: { band: SnapshotResult["priceBand"] }) {
  const lo = Math.min(band.low, band.userPrice ?? band.low);
  const hi = Math.max(band.high, band.userPrice ?? band.high);
  const pad = (hi - lo) * 0.15 || 5;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <figure>
      <div className="relative h-10">
        <div className="absolute top-4 right-0 left-0 h-1.5 rounded-full bg-subtle" />
        <div
          className="absolute top-4 h-1.5 rounded-full bg-accent/30"
          style={{ left: pct(band.low), width: `calc(${pct(band.high)} - ${pct(band.low)})` }}
        />
        {band.userPrice != null && (
          <div className="absolute top-0 -translate-x-1/2 text-center" style={{ left: pct(band.userPrice) }}>
            <span className="block font-mono text-[11px] text-accent">You ${band.userPrice}</span>
            <span className="mx-auto mt-0.5 block h-4 w-0.5 rounded bg-accent" />
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex justify-between font-mono text-[11px] text-ink-3">
        <span>${band.low}</span>
        <span>${band.high}</span>
      </figcaption>
    </figure>
  );
}

export function SnapshotTab({ jobs, onNextStep, busy }: { jobs: JobView[]; onNextStep: (s: NextStep) => void; busy: boolean }) {
  const snapshots = jobs.filter((j) => j.type === "market_snapshot");
  const done = snapshots.find((j) => j.result && (j.status === "delivered" || j.status === "accepted"));
  const running = snapshots.find((j) => j.status === "in_progress" || j.status === "approved");

  if (!done) {
    return (
      <div className="space-y-4">
        {running ? (
          <>
            <p className="font-medium">Researching your market</p>
            <ProgressList steps={running.steps} reached={running.reachedStep} />
            <p className="text-[13px] text-ink-3">{String(running.events.filter((e) => e.kind === "progress").at(-1)?.payload.note ?? "")}</p>
          </>
        ) : (
          <>
            <div>
              <p className="font-medium">No snapshot yet</p>
              <p className="mt-0.5 text-[13px] text-ink-2">See who you’re up against, what they charge, and the lane nobody owns.</p>
            </div>
            <NextStepCard step={DEFAULT_NEXT_STEPS[0]} onPick={onNextStep} disabled={busy} />
          </>
        )}
      </div>
    );
  }

  const r = done.result as unknown as SnapshotResult;
  return (
    <div className="space-y-6">
      <section>
        <p className="text-[12px] text-ink-3">Open lane</p>
        <p className="mt-1 text-[15px] leading-snug font-medium">{r.openLane}</p>
      </section>
      <section>
        <p className="mb-2 text-[12px] text-ink-3">Price band</p>
        <PriceBand band={r.priceBand} />
      </section>
      <section>
        <p className="mb-2 text-[12px] text-ink-3">Competitors ({r.competitors.length})</p>
        <ul className="divide-y divide-line border-y border-line">
          {r.competitors.map((c, i) => (
            <li key={i} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-accent hover:underline">
                  {c.name}
                </a>
                <span className="shrink-0 font-mono text-[12px]">{c.kitPrice}</span>
              </div>
              <p className="text-[13px] text-ink-2">{c.angle}</p>
              <p className="mt-0.5 flex justify-between gap-2 font-mono text-[11px] text-ink-3">
                <span>{c.productCount} products</span>
                <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="truncate hover:text-accent">
                  Source: {hostname(c.sourceUrl)}
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
