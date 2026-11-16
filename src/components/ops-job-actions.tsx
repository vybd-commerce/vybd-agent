"use client";

import { useState, useTransition } from "react";
import { claimJobAction, deliverJobAction, failJobAction, postProgressAction } from "@/app/actions";
import type { DeliveryField, DeliveryForm, JobStep } from "@/lib/jobs/types";
import type { JobView } from "@/lib/services/jobs";
import { JobThread } from "./jobs-tab";

type Row = Record<string, string>;

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
}

function coerce(field: DeliveryField, raw: string) {
  if (field.type === "number") return raw.trim() === "" ? null : Number(raw);
  return raw.trim();
}

function Input({ field, value, onChange }: { field: DeliveryField; value: string; onChange: (v: string) => void }) {
  const cls = "w-full rounded-lg border border-line px-2.5 py-1.5 outline-none focus:border-focus";
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-ink-3">{field.label}</span>
      {field.type === "textarea" ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}

function DeliverForm({ job, form }: { job: JobView; form: DeliveryForm }) {
  const existing = (job.result ?? {}) as Record<string, unknown>;
  const emptyRow = () => Object.fromEntries(form.itemFields.map((f) => [f.key, ""]));
  const [rows, setRows] = useState<Row[]>(() => {
    const list = (existing[form.listKey] as Record<string, unknown>[] | undefined) ?? [];
    const filled = list.map((r) => Object.fromEntries(form.itemFields.map((f) => [f.key, String(r[f.key] ?? "")])));
    while (filled.length < form.minItems) filled.push(emptyRow());
    return filled;
  });
  const [extras, setExtras] = useState<Row>(() =>
    Object.fromEntries(form.extraFields.map((f) => [f.key, String(getPath(existing, f.key) ?? "")])),
  );
  const [json, setJson] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const build = () => {
    const result: Record<string, unknown> = {
      [form.listKey]: rows.map((r) => Object.fromEntries(form.itemFields.map((f) => [f.key, coerce(f, r[f.key] ?? "")]))),
    };
    for (const f of form.extraFields) {
      const v = coerce(f, extras[f.key] ?? "");
      if (v !== null && v !== "") setPath(result, f.key, v);
    }
    return result;
  };

  const submit = () =>
    start(async () => {
      let result: unknown;
      try {
        result = json !== null ? JSON.parse(json) : build();
      } catch {
        return setError("That JSON doesn't parse.");
      }
      const res = await deliverJobAction(job.id, result);
      setError(res.ok ? null : res.error);
    });

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Deliver</h2>
        <button className="text-[12px] text-accent-text" onClick={() => setJson(json === null ? JSON.stringify(build(), null, 2) : null)}>
          {json === null ? "Edit as JSON" : "Back to form"}
        </button>
      </div>
      {json !== null ? (
        <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={18} className="w-full rounded-lg border border-line p-2.5 font-mono text-[12px] outline-none focus:border-focus" />
      ) : (
        <>
          <p className="text-[13px] text-ink-2">
            {form.listLabel}: {form.minItems}–{form.maxItems}. The founder sees exactly what you enter.
          </p>
          <ol className="space-y-4">
            {rows.map((row, i) => (
              <li key={i} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">#{i + 1}</span>
                  {rows.length > form.minItems && (
                    <button className="text-[12px] text-ink-3 hover:text-danger" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {form.itemFields.map((f) => (
                    <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                      <Input field={f} value={row[f.key] ?? ""} onChange={(v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {rows.length < form.maxItems && (
            <button className="h-8 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle" onClick={() => setRows((r) => [...r, emptyRow()])}>
              Add another
            </button>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {form.extraFields.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                <Input field={f} value={extras[f.key] ?? ""} onChange={(v) => setExtras((x) => ({ ...x, [f.key]: v }))} />
              </div>
            ))}
          </div>
        </>
      )}
      {error && <pre className="rounded-lg bg-subtle p-2 text-[12px] whitespace-pre-wrap text-danger">{error}</pre>}
      <button onClick={submit} disabled={pending} className="h-9 rounded-full bg-accent px-4 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Delivering…" : "Deliver to founder"}
      </button>
    </section>
  );
}

export function OpsJobActions({ job, isMine, deliveryForm, steps }: { job: JobView; isMine: boolean; deliveryForm: DeliveryForm; steps: JobStep[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [step, setStep] = useState("");
  const workable = job.status === "in_progress" || job.status === "failed";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Failed"));
    });

  return (
    <>
      {error && <p className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-danger">{error}</p>}
      {!job.operatorId && workable && (
        <section className="rounded-xl border border-focus bg-accent-soft p-4">
          <p className="font-medium">Unclaimed</p>
          <p className="text-[13px] text-ink-2">Claim it to tell the founder an operator is assigned.</p>
          <button onClick={() => run(() => claimJobAction(job.id))} disabled={pending} className="mt-3 h-8 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink disabled:opacity-60">
            Claim job
          </button>
        </section>
      )}
      {job.status === "quoted" && <p className="text-ink-2">Waiting for the founder to approve{job.priceCents ? " and pay" : ""}.</p>}

      {workable && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Post an update</h2>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              run(async () => {
                const res = await postProgressAction(job.id, { step: step || undefined, note: note.trim() });
                if (res.ok) setNote("");
                return res;
              });
            }}
          >
            <select value={step} onChange={(e) => setStep(e.target.value)} aria-label="Step completed" className="h-9 rounded-lg border border-line px-2 text-[13px]">
              <option value="">No step change</option>
              {steps
                .filter((s) => s.key !== "delivered")
                .map((s) => (
                  <option key={s.key} value={s.key}>
                    Completed: {s.label}
                  </option>
                ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contacted 8 manufacturers, 5 replied" aria-label="Update" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 outline-none focus:border-focus" />
            <button disabled={pending} className="h-9 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle">
              Post
            </button>
          </form>
        </section>
      )}

      {workable && (isMine || !job.operatorId) && <DeliverForm job={job} form={deliveryForm} />}

      {job.fulfiller !== "agent" || job.status === "failed" ? <JobThread job={job} asOperator /> : null}

      {job.status === "in_progress" && (
        <button
          onClick={() => {
            const reason = prompt("Why can't this job be completed? The founder sees this.");
            if (reason) run(() => failJobAction(job.id, reason));
          }}
          className="text-[13px] text-ink-3 hover:text-danger"
        >
          Mark as failed
        </button>
      )}
    </>
  );
}
