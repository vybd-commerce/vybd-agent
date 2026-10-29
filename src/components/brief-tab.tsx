"use client";

import { useState, useTransition } from "react";
import { createSharePageAction, editBriefFieldAction, shareSettingsAction } from "@/app/actions";
import { BRIEF_FIELDS, BRIEF_LABELS, formatValue, isFilled, type BriefFieldKey } from "@/lib/brief";
import type { BrandState } from "@/lib/services/brand-state";
import type { NextStep } from "@/lib/types";
import { DEFAULT_NEXT_STEPS } from "@/lib/types";
import { NextStepCard } from "./next-step-card";

const LIST_FIELDS: BriefFieldKey[] = ["channels", "nameDirections", "openQuestions"];
const SHAREABLE = BRIEF_FIELDS.filter((k) => k !== "openQuestions");

/** Brief field: small grey label over value. Pending fields show "Asking now…". Click to edit. */
function BriefField(props: {
  brandId: string;
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
    <div key={props.flashKey} className={`-mx-2 rounded-lg px-2 py-2 ${props.flashKey ? "brief-flash" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] text-ink-3">{BRIEF_LABELS[props.field]}</p>
        {!editing && (
          <button
            onClick={() => {
              setDraft(isList ? ((props.value as string[]) ?? []).join("\n") : formatValue(props.value));
              setEditing(true);
            }}
            className="text-[12px] text-ink-3 hover:text-accent"
            aria-label={`Edit ${BRIEF_LABELS[props.field]}`}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={isList ? 3 : 2}
            placeholder={isList ? "One per line" : ""}
            className="w-full resize-y rounded-lg border border-line px-2.5 py-1.5 outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={pending} className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white disabled:opacity-60">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="h-7 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-subtle">
              Cancel
            </button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      ) : props.asking && !filled ? (
        <p className="text-ink-3 italic">Asking now…</p>
      ) : !filled ? (
        <p className="text-ink-3">—</p>
      ) : isList ? (
        <ul className="mt-0.5 space-y-0.5">
          {(props.value as string[]).map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 leading-snug">{formatValue(props.value)}</p>
      )}
    </div>
  );
}

function FeedbackBlock({ state }: { state: BrandState }) {
  const fb = state.feedback;
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const hidden = state.brand.shareHiddenFields;

  if (!fb.published) {
    return (
      <section className="rounded-xl border border-line p-3.5">
        <p className="font-medium">Feedback page</p>
        <p className="mt-0.5 text-[13px] text-ink-2">Publish a page from this brief that asks people if they would buy it.</p>
        <button
          disabled={pending}
          onClick={() => start(async () => void (await createSharePageAction(state.brand.id)))}
          className="mt-3 h-8 rounded-lg border border-line px-3 text-[13px] font-medium hover:bg-subtle disabled:opacity-60"
        >
          Publish feedback page
        </button>
      </section>
    );
  }

  const bars: { key: "yes" | "maybe" | "no"; label: string }[] = [
    { key: "yes", label: "Would buy" },
    { key: "maybe", label: "Maybe" },
    { key: "no", label: "Wouldn't buy" },
  ];
  const max = Math.max(1, ...Object.values(fb.counts));

  return (
    <section className="rounded-xl border border-line p-3.5">
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
          className="shrink-0 text-[12px] font-medium text-accent"
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
                  className="accent-[var(--accent)]"
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
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-ink-2">{brief.usable ? "Usable brief" : "Brief in progress"}</p>
        <p className="font-mono text-[11px] text-ink-3">v{brief.version}</p>
      </div>
      <div className="space-y-1">
        {BRIEF_FIELDS.map((k) => (
          <BriefField
            key={k}
            brandId={state.brand.id}
            field={k}
            value={brief.fields[k]}
            asking={brief.pending.includes(k)}
            flashKey={flash.keys.includes(k) ? flash.at : 0}
          />
        ))}
      </div>
      {brief.usable && (
        <section className="space-y-2">
          <p className="text-[13px] text-ink-2">Next steps</p>
          {DEFAULT_NEXT_STEPS.map((s) => (
            <NextStepCard key={s.kind} step={s} onPick={onNextStep} disabled={busy} />
          ))}
        </section>
      )}
      <FeedbackBlock state={state} />
    </div>
  );
}
