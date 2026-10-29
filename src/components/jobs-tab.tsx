"use client";

import { useState, useTransition } from "react";
import { acceptJobAction, postJobMessageAction, updateJobSpecAction } from "@/app/actions";
import type { SuppliersResult } from "@/lib/jobs/find-suppliers";
import type { JobView } from "@/lib/services/jobs";
import { formatEta, formatPrice, jobStatusLine } from "./format";
import { JobStatusCard, QuoteCard } from "./job-cards";
import { ProgressList } from "./progress-list";

const SPEC_LABELS: Record<string, string> = { moq: "MOQ", targetUnitCost: "Target unit cost", mustHaves: "Must-haves" };

function humanize(key: string) {
  if (SPEC_LABELS[key]) return SPEC_LABELS[key];
  const s = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function SpecView({ spec }: { spec: Record<string, unknown> }) {
  const entries = Object.entries(spec).filter(([, v]) => (Array.isArray(v) ? v.length : v !== "" && v != null));
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[12px] text-ink-3">{humanize(k)}</dt>
          <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SpecEditor({ job, onDone }: { job: JobView; onDone: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(job.spec).map(([k, v]) => [k, Array.isArray(v) ? v.join("\n") : String(v ?? "")])),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isList = (k: string) => Array.isArray(job.spec[k]);

  const save = () =>
    start(async () => {
      const spec = Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, isList(k) ? v.split("\n").map((s) => s.trim()).filter(Boolean) : v.trim()]),
      );
      const res = await updateJobSpecAction(job.id, spec);
      if (!res.ok) return setError(res.error);
      onDone();
    });

  return (
    <div className="space-y-3">
      {Object.keys(draft).map((k) => (
        <label key={k} className="block">
          <span className="mb-1 block text-[12px] text-ink-3">
            {humanize(k)}
            {isList(k) && " (one per line)"}
          </span>
          <textarea
            value={draft[k]}
            rows={isList(k) ? 3 : 1}
            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            className="w-full resize-y rounded-lg border border-line px-2.5 py-1.5 outline-none focus:border-accent"
          />
        </label>
      ))}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={pending} className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-60">
          Save spec
        </button>
        <button onClick={onDone} className="h-8 rounded-lg px-3 text-[13px] text-ink-2 hover:bg-subtle">
          Cancel
        </button>
      </div>
    </div>
  );
}

function SuppliersResultView({ result }: { result: SuppliersResult }) {
  return (
    <div className="space-y-3">
      {result.summary && <p className="text-ink-2">{result.summary}</p>}
      <ul className="space-y-3">
        {result.suppliers.map((s, i) => (
          <li key={i} className="rounded-xl border border-line p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </p>
              <span className="shrink-0 text-[12px] text-ink-3">{s.location}</span>
            </div>
            <p className="mt-0.5 text-[13px] break-words text-ink-2">{s.contact}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[12px]">
              {(
                [
                  ["MOQ", s.moq],
                  ["Unit price", s.unitPrice],
                  ["Lead time", s.leadTime],
                  ["Sample", s.sampleCost],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt className="font-sans text-[11px] text-ink-3">{label}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {s.notes && <p className="mt-2 border-t border-line pt-2 text-[13px]">{s.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobThread({ job, asOperator }: { job: JobView; asOperator?: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const messages = job.events.filter((e) => e.kind === "message");
  const mine = asOperator ? "operator" : "user";
  return (
    <section>
      <p className="mb-2 text-[12px] text-ink-3">{asOperator ? "Thread with the founder" : "Message your operator"}</p>
      {messages.length > 0 && (
        <ul className="mb-3 space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={`flex ${m.actor === mine ? "justify-end" : ""}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-1.5 ${m.actor === mine ? "bg-subtle" : "border border-line"}`}>
                <p className="text-[11px] text-ink-3">{m.actor === "operator" ? "Operator" : "Founder"}</p>
                <p className="whitespace-pre-wrap">{String(m.payload.text)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          start(async () => {
            const res = await postJobMessageAction(job.id, t);
            if (!res.ok) return setError(res.error);
            setText("");
            setError(null);
          });
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={asOperator ? "Ask the founder something" : "Ask a question about this job"}
          aria-label="Message"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 outline-none focus:border-accent"
        />
        <button disabled={pending || !text.trim()} className="h-9 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle disabled:opacity-50">
          Send
        </button>
      </form>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </section>
  );
}

function JobDetail({
  job,
  editingSpec,
  setEditingSpec,
  onBack,
  onOpenSnapshot,
}: {
  job: JobView;
  editingSpec: boolean;
  setEditingSpec: (v: boolean) => void;
  onBack: () => void;
  onOpenSnapshot: () => void;
}) {
  const [pending, start] = useTransition();
  const finished = job.status === "delivered" || job.status === "accepted";
  const notes: Record<string, string> = {};
  for (const e of job.events) {
    if (e.kind !== "progress" || !e.payload.step || !e.payload.note) continue;
    const label = job.steps.find((st) => st.key === e.payload.step)?.label.toLowerCase();
    const note = String(e.payload.note);
    // Skip notes that just repeat the step name ("Operator assigned", "Delivered").
    if (note.toLowerCase() !== label && note !== "Delivered") notes[String(e.payload.step)] = note;
  }
  const latestNote = job.events.filter((e) => e.kind === "progress" && e.payload.note).at(-1);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-[13px] text-ink-2 hover:text-ink">
        ‹ All jobs
      </button>
      <div>
        <p className="text-[16px] font-semibold">{job.title}</p>
        <p className="font-mono text-[11px] text-ink-3">{jobStatusLine(job)}</p>
        <p className="mt-1 font-mono text-[11px] text-ink-3">
          {formatPrice(job.priceCents)} · {formatEta(job.etaDays)}
        </p>
      </div>

      {job.status === "quoted" && !editingSpec && <QuoteCard job={job} onEditSpec={() => setEditingSpec(true)} />}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[12px] text-ink-3">Spec</p>
          {job.status === "quoted" && !editingSpec && (
            <button onClick={() => setEditingSpec(true)} className="text-[12px] text-accent">
              Edit spec
            </button>
          )}
        </div>
        {editingSpec ? <SpecEditor job={job} onDone={() => setEditingSpec(false)} /> : <SpecView spec={job.spec} />}
      </section>

      {!["quoted", "cancelled", "draft"].includes(job.status) && (
        <section>
          <p className="mb-2 text-[12px] text-ink-3">Progress</p>
          <ProgressList steps={job.steps} reached={job.reachedStep} finished={finished} notes={notes} />
          {!finished && latestNote && <p className="mt-2 text-[13px] text-ink-3">Latest: {String(latestNote.payload.note)}</p>}
        </section>
      )}

      {job.result && (
        <section>
          <p className="mb-2 text-[12px] text-ink-3">Result</p>
          {job.type === "find_suppliers" ? (
            <SuppliersResultView result={job.result as unknown as SuppliersResult} />
          ) : job.type === "market_snapshot" ? (
            <button onClick={onOpenSnapshot} className="text-accent hover:underline">
              Open the snapshot
            </button>
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-subtle p-2 text-[12px]">{JSON.stringify(job.result, null, 2)}</pre>
          )}
          {job.status === "delivered" && (
            <button
              disabled={pending}
              onClick={() => start(async () => void (await acceptJobAction(job.id)))}
              className="mt-3 h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-60"
            >
              Accept delivery
            </button>
          )}
        </section>
      )}

      {job.fulfiller !== "agent" && !["cancelled", "draft"].includes(job.status) && <JobThread job={job} />}
    </div>
  );
}

export function JobsTab(props: {
  jobs: JobView[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  editingSpec: boolean;
  setEditingSpec: (v: boolean) => void;
  onOpenSnapshot: () => void;
}) {
  const selected = props.jobs.find((j) => j.id === props.selectedId);
  if (selected) {
    return (
      <JobDetail
        job={selected}
        editingSpec={props.editingSpec}
        setEditingSpec={props.setEditingSpec}
        onBack={() => props.setSelectedId(null)}
        onOpenSnapshot={props.onOpenSnapshot}
      />
    );
  }
  if (props.jobs.length === 0) {
    return (
      <div>
        <p className="font-medium">No jobs yet</p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          When you ask for a market snapshot or suppliers, the quote and progress show up here. Nothing costs anything until you approve.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {props.jobs.map((j) => (
        <li key={j.id}>
          <JobStatusCard job={j} onView={props.setSelectedId} />
        </li>
      ))}
    </ul>
  );
}
