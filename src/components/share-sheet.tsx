"use client";

import { useEffect, useState, useTransition } from "react";
import { createSharePageAction, getInviteAction, resetInviteAction } from "@/app/actions";
import type { BrandState } from "@/lib/services/brand-state";

export type ShareMode = "invite" | "feedback";

/** Pre-filled links for the places people actually send things. */
function channels(url: string, text: string, subject: string) {
  const t = encodeURIComponent(`${text} ${url}`);
  return [
    { label: "WhatsApp", href: `https://wa.me/?text=${t}` },
    { label: "X", href: `https://x.com/intent/post?text=${t}` },
    { label: "Email", href: `mailto:?subject=${encodeURIComponent(subject)}&body=${t}` },
    { label: "Text", href: `sms:?&body=${t}` },
  ];
}

function LinkRow({ url, label, text, subject }: { url: string; label: string; text: string; subject: string }) {
  const [copied, setCopied] = useState(false);
  // The sheet only renders after a click, so navigator is always there.
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-line p-1 pl-2.5">
        <input readOnly value={url} aria-label={label} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 truncate bg-transparent font-mono text-[12px] text-ink-2 outline-none" />
        <button onClick={copy} className="h-8 shrink-0 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {canShare && (
          <button
            onClick={() => navigator.share({ title: subject, text, url }).catch(() => {})}
            className="h-8 rounded-md border border-line px-3 text-[13px] font-medium hover:bg-subtle"
          >
            Share…
          </button>
        )}
        {channels(url, text, subject).map((c) => (
          <a key={c.label} href={c.href} target="_blank" rel="noreferrer" className="flex h-8 items-center rounded-md border border-line px-3 text-[13px] font-medium hover:bg-subtle">
            {c.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export function ShareSheet({
  state,
  mode,
  onMode,
  onClose,
  onChanged,
}: {
  state: BrandState;
  mode: ShareMode;
  onMode: (m: ShareMode) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const brandId = state.brand.id;
  const name = state.brand.name;
  const oneLiner = typeof state.brief.fields.oneLiner === "string" ? state.brief.fields.oneLiner : "";
  const isOwner = state.viewerRole === "owner";

  useEffect(() => {
    if (mode !== "invite" || invite) return;
    getInviteAction(brandId).then((r) => (r.ok ? setInvite({ url: r.data.url, expiresAt: String(r.data.expiresAt) }) : setError(r.error)));
  }, [mode, invite, brandId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reset = () =>
    start(async () => {
      const r = await resetInviteAction(brandId);
      if (r.ok) setInvite({ url: r.data.url, expiresAt: String(r.data.expiresAt) });
      else setError(r.error);
    });

  const publish = () =>
    start(async () => {
      const r = await createSharePageAction(brandId);
      if (r.ok) onChanged();
      else setError(r.error);
    });

  const tabs: { key: ShareMode; label: string }[] = [
    { key: "invite", label: "Invite to build" },
    { key: "feedback", label: "Get feedback" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] rounded-t-2xl border border-line bg-bg p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-subtle p-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => onMode(t.key)}
                className={`h-8 rounded-md px-3 text-[13px] font-medium ${mode === t.key ? "bg-bg shadow-sm" : "text-ink-2"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-md text-ink-3 hover:bg-subtle">
            ✕
          </button>
        </div>

        {mode === "invite" ? (
          <div className="mt-5">
            <p className="font-medium">Build {name} with friends</p>
            <p className="mt-1 text-[13px] text-ink-2">
              Anyone with the link joins the team: one shared thread, one Brand Brain. Only you approve anything paid.
            </p>
            {state.members.length > 1 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {state.members.map((m) => (
                  <li key={m.userId} className="rounded-md bg-subtle px-2 py-0.5 text-[12px] text-ink-2">
                    {m.name}
                    {m.role === "owner" ? " · owner" : ""}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              {invite ? (
                <LinkRow
                  url={invite.url}
                  label="Invite link"
                  subject={`Join me on ${name}`}
                  text={`I'm building ${name}${oneLiner ? `: ${oneLiner}` : ""}. Want in? Join me on Vybd:`}
                />
              ) : (
                !error && <p className="text-[13px] text-ink-3">Making your link…</p>
              )}
            </div>
            {invite && (
              <p className="mt-3 text-[12px] text-ink-3">
                Works for 7 days.
                {isOwner && (
                  <>
                    {" "}
                    <button disabled={pending} onClick={reset} className="font-medium text-ink-2 underline-offset-2 hover:underline disabled:opacity-50">
                      Reset link
                    </button>{" "}
                    to stop the old one working.
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5">
            <p className="font-medium">Ask strangers: would you buy this?</p>
            <p className="mt-1 text-[13px] text-ink-2">
              A public page from your brief. Friends are polite; people you don’t know tell you the truth.
            </p>
            <div className="mt-4">
              {state.feedback.url ? (
                <>
                  <LinkRow
                    url={state.feedback.url}
                    label="Share page link"
                    subject={`Would you buy ${name}?`}
                    text={`I'm working on ${name}${oneLiner ? `: ${oneLiner}` : ""}. Would you buy it? 30 seconds, honest answers only:`}
                  />
                  <p className="mt-3 text-[12px] text-ink-3">
                    {state.feedback.total} responses so far ·{" "}
                    <a href={state.feedback.url} target="_blank" rel="noreferrer" className="font-medium text-ink-2 hover:underline">
                      Open page
                    </a>
                  </p>
                </>
              ) : (
                <button
                  disabled={pending || !state.brief.usable}
                  onClick={publish}
                  className="h-10 w-full rounded-full bg-accent font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
                >
                  {state.brief.usable ? "Publish feedback page" : "Fill one-liner, customer and positioning first"}
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
