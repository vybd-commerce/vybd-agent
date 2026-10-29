"use client";

import { useState, useTransition } from "react";
import { approveJobAction, cancelJobAction } from "@/app/actions";
import type { JobView } from "@/lib/services/jobs";
import { formatEta, formatPrice, jobStatusLine } from "./format";

function JobIcon({ status }: { status: JobView["status"] }) {
  const done = status === "delivered" || status === "accepted";
  const bad = status === "failed" || status === "cancelled";
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
        done ? "bg-accent text-white" : bad ? "bg-subtle text-danger" : "bg-accent-soft text-accent"
      }`}
    >
      {done ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7.3 5.8 10 11 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : bad ? (
        <span className="text-[14px] font-semibold">!</span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={status === "in_progress" ? "animate-spin [animation-duration:2.4s]" : ""}>
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="22 10" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** Job card (status): icon, name, status line, View link. */
export function JobStatusCard({ job, onView }: { job: JobView; onView: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
      <JobIcon status={job.status} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{job.title}</p>
        <p className="font-mono text-[11px] text-ink-3">{jobStatusLine(job)}</p>
      </div>
      <button onClick={() => onView(job.id)} className="text-[13px] font-medium text-accent hover:underline">
        View
      </button>
    </div>
  );
}

/** Quote card: title, deliverable, price, ETA, fulfiller, then Approve & start / Edit spec / Not yet. */
export function QuoteCard({ job, onEditSpec }: { job: JobView; onEditSpec: (id: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const awaitingPayment = job.events.some((e) => e.payload.checkout);

  const approve = () =>
    start(async () => {
      setError(null);
      const res = await approveJobAction(job.id);
      if (!res.ok) return setError(res.error);
      if (res.data.checkoutUrl) window.location.href = res.data.checkoutUrl;
    });

  if (dismissed) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] text-ink-2">
        <span>{job.title} quote saved for later.</span>
        <button className="font-medium text-accent hover:underline" onClick={() => setDismissed(false)}>
          Show quote
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line">
      <div className="px-4 pt-3.5 pb-3">
        <p className="font-medium">{job.title}</p>
        <p className="mt-0.5 text-ink-2">{job.deliverable}</p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-[12px] text-ink-3">Price</dt>
            <dd className="font-mono text-[13px]">{formatPrice(job.priceCents)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-3">ETA</dt>
            <dd className="font-mono text-[13px]">{formatEta(job.etaDays)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-3">Done by</dt>
            <dd className="text-[13px]">{job.fulfillerLabel}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-ink-3">
          {job.priceCents === 0 ? "Free. Starts as soon as you approve." : "You pay only when you approve. Nothing is charged before."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <button
          onClick={approve}
          disabled={pending}
          className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Starting…" : awaitingPayment ? "Continue to payment" : "Approve & start"}
        </button>
        <button
          onClick={() => onEditSpec(job.id)}
          className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle"
        >
          Edit spec
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="h-8 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-subtle"
        >
          Not yet
        </button>
        <button
          onClick={() => start(async () => void (await cancelJobAction(job.id)))}
          className="ml-auto text-[12px] text-ink-3 hover:text-ink-2"
        >
          Cancel quote
        </button>
      </div>
      {error && <p className="border-t border-line px-4 py-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function JobCard(props: { job: JobView; onView: (id: string) => void; onEditSpec: (id: string) => void }) {
  if (props.job.status === "quoted") return <QuoteCard job={props.job} onEditSpec={props.onEditSpec} />;
  return <JobStatusCard job={props.job} onView={props.onView} />;
}
