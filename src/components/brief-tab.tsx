"use client";

import { useEffect, useState, useTransition } from "react";
import { editBriefFieldAction, shareSettingsAction } from "@/app/actions";
import { BRIEF_FIELDS, BRIEF_LABELS, formatValue, isFilled, type BriefFieldKey } from "@/lib/brief";
import type { BrandState } from "@/lib/services/brand-state";
import type { NextStep } from "@/lib/types";
import { DEFAULT_NEXT_STEPS } from "@/lib/types";
import { timeAgo } from "./format";
import { NextStepCard } from "./next-step-card";

const LIST_FIELDS: BriefFieldKey[] = ["competitors", "channels", "nameDirections", "openQuestions"];
const SHAREABLE = BRIEF_FIELDS.filter((k) => k !== "openQuestions" && k !== "goals");
// Short fields that sit side by side, as in the mockup.
const PAIRED: BriefFieldKey[] = ["price", "channels"];

/** Brief field: small grey label over value. Pending fields show "Asking now…". Click to edit. */
function BriefField(props: {
  brandId: string;
  brandName: string;
  field: BriefFieldKey;
  value: unknown;
  asking: boolean;
  flashKey: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isList = LIST_FIELDS.includes(props.field);
  const filled = isFilled(props.value);

  const save = () =>
    start(async () => {
      const value = isList ? draft.split("\n").map((s) => s.trim()).filter(Boolean) : draft.trim();
      const res = await editBriefFieldAction(props.brandId, props.field, value);
      if (!res.ok) return setError(res.error);
      setError(null);
      setEditing(false);
    });

  return (
    <div key={props.flashKey} className={`group -mx-2 min-w-0 flex-1 rounded-lg px-2 py-1 ${props.flashKey ? "brief-flash" : ""}`}>
      <dt className="mb-1 flex items-baseline justify-between gap-2 text-[12px] text-ink-3">
        {BRIEF_LABELS[props.field]}
        {!editing && (
          <button
            onClick={() => {
              setDraft(isList ? ((props.value as string[]) ?? []).join("\n") : formatValue(props.value));
              setEditing(true);
            }}
            className="text-[12px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-accent-text focus-visible:opacity-100"
            aria-label={`Edit ${BRIEF_LABELS[props.field]}`}
          >
            Edit
          </button>
        )}
      </dt>
      <dd className="m-0">
        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={isList ? 3 : 2}
              placeholder={isList ? "One per line" : ""}
              className="w-full resize-y rounded-lg border border-line-strong bg-bg px-2.5 py-1.5 outline-none focus:border-focus"
            />
            <div className="flex gap-2">
              <button onClick={save} disabled={pending} className="h-7 rounded-full bg-accent px-2.5 text-[12px] font-medium text-accent-ink disabled:opacity-60">
                Save
              </button>
              <button onClick={() => setEditing(false)} className="h-7 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-subtle">
                Cancel
              </button>
            </div>
            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>
        ) : props.asking && !filled ? (
          <span className="text-ink-3 italic">Asking now…</span>
        ) : !filled ? (
          <span className="text-ink-3">Not set</span>
        ) : props.field === "nameDirections" ? (
          <ul className="mt-0.5 flex flex-wrap gap-1.5">
            {(props.value as string[]).map((v, i) => {
              const current = v.trim().toLowerCase() === props.brandName.trim().toLowerCase();
              return (
                <li key={i} className={`rounded-full border px-2.5 py-1 ${current ? "border-ink font-medium" : "border-line-strong"}`}>
                  {v}
                </li>
              );
            })}
          </ul>
        ) : isList ? (
          <ul className="space-y-0.5">
            {(props.value as string[]).map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        ) : props.field === "oneLiner" ? (
          <p className="text-[15px] leading-[1.4] font-medium">{formatValue(props.value)}</p>
        ) : (
          <p>{formatValue(props.value)}</p>
        )}
      </dd>
    </div>
  );
}

/** Published share page: link, response counts, and which fields the page shows. */
function FeedbackBlock({ state }: { state: BrandState }) {
  const fb = state.feedback;
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const hidden = state.brand.shareHiddenFields;

  const bars: { key: "yes" | "maybe" | "no"; label: string }[] = [
    { key: "yes", label: "Would buy" },
    { key: "maybe", label: "Maybe" },
    { key: "no", label: "Wouldn't buy" },
  ];
  const max = Math.max(1, ...Object.values(fb.counts));

  return (
    <section className="rounded-xl border border-line bg-bg p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">Feedback</p>
        <p className="font-mono text-[11px] text-ink-3">{fb.total} responses</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={fb.url ?? ""} aria-label="Share page link" className="min-w-0 flex-1 truncate rounded-md bg-subtle px-2 py-1 font-mono text-[11px] text-ink-2" />
        <button
          onClick={() => {
            navigator.clipboard.writeText(fb.url ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 text-[12px] font-medium text-accent-text"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {bars.map((b) => (
          <li key={b.key} className="grid grid-cols-[88px_1fr_28px] items-center gap-2 text-[13px]">
            <span className="text-ink-2">{b.label}</span>
            <span className="h-1.5 rounded-full bg-subtle">
              <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${(fb.counts[b.key] / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-[12px]">{fb.counts[b.key]}</span>
          </li>
        ))}
      </ul>
      {fb.emails > 0 && <p className="mt-2 text-[12px] text-ink-3">{fb.emails} left an email for launch.</p>}
      {fb.priceAnswers.length > 0 && (
        <p className="mt-2 text-[13px] text-ink-2">Prices people named: {fb.priceAnswers.slice(0, 6).join(", ")}</p>
      )}
      {fb.comments.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {fb.comments.slice(0, 4).map((c, i) => (
            <li key={i} className="text-[13px] text-ink-2">
              “{c.comment}”
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3 border-t border-line pt-2">
        <summary className="cursor-pointer text-[12px] text-ink-2">Choose what the page shows</summary>
        <ul className="mt-2 space-y-1">
          {SHAREABLE.map((k) => (
            <li key={k}>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[var(--focus)]"
                  checked={!hidden.includes(k)}
                  disabled={pending}
                  onChange={(e) =>
                    start(async () => {
                      const next = e.target.checked ? hidden.filter((h) => h !== k) : [...hidden, k];
                      await shareSettingsAction(state.brand.id, { hiddenFields: next });
                    })
                  }
                />
                {BRIEF_LABELS[k]}
              </label>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function BriefTab({
  state,
  flash,
  onNextStep,
  busy,
}: {
  state: BrandState;
  flash: { keys: string[]; at: number };
  onNextStep: (s: NextStep) => void;
  busy: boolean;
}) {
  const { brief } = state;
  const [showEmpty, setShowEmpty] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Like the mockup, the brief shows what's known or being asked; empty fields are one click away.
  const visible = (k: BriefFieldKey) => showEmpty || isFilled(brief.fields[k]) || brief.pending.includes(k);
  const hiddenCount = BRIEF_FIELDS.filter((k) => !visible(k)).length;
  const field = (k: BriefFieldKey) => (
    <BriefField
      key={k}
      brandId={state.brand.id}
      brandName={state.brand.name}
      field={k}
      value={brief.fields[k]}
      asking={brief.pending.includes(k)}
      flashKey={flash.keys.includes(k) ? flash.at : 0}
    />
  );

  return (
    <div className="flex flex-1 flex-col gap-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Brand brief</h2>
        {brief.version > 0 && (
          <span className="font-mono text-[11px] text-ink-3">
            v{brief.version}
            {brief.updatedAt ? ` · updated ${timeAgo(brief.updatedAt, now)}` : ""}
          </span>
        )}
      </div>

      {brief.version === 0 && !showEmpty ? (
        <p className="text-ink-3">The brief fills in here while your assistant interviews you: one-liner, customer, positioning, price and more.</p>
      ) : (
        <dl className="m-0 flex flex-col gap-3">
          {BRIEF_FIELDS.filter((k) => !PAIRED.includes(k) && visible(k) && BRIEF_FIELDS.indexOf(k) < BRIEF_FIELDS.indexOf("price")).map(field)}
          {PAIRED.some(visible) && <div className="flex gap-4">{PAIRED.filter(visible).map(field)}</div>}
          {BRIEF_FIELDS.filter((k) => !PAIRED.includes(k) && visible(k) && BRIEF_FIELDS.indexOf(k) > BRIEF_FIELDS.indexOf("price")).map(field)}
        </dl>
      )}
      {hiddenCount > 0 && (
        <button onClick={() => setShowEmpty(true)} className="-mt-2 self-start text-[12px] text-ink-3 hover:text-accent-text">
          Show empty fields ({hiddenCount})
        </button>
      )}

      {state.feedback.published && <FeedbackBlock state={state} />}

      {brief.usable && (
        <section className="mt-auto flex flex-col gap-2">
          <p className="text-[12px] text-ink-3">Next steps</p>
          {DEFAULT_NEXT_STEPS.map((s) => (
            <NextStepCard key={s.kind} step={s} onPick={onNextStep} disabled={busy} />
          ))}
        </section>
      )}
    </div>
  );
}
