"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/app/actions";

const OPTIONS = [
  { value: "yes", label: "Yes, I'd buy it" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
] as const;

export function FeedbackForm({ slug, price }: { slug: string; price: string | null }) {
  const [wouldBuy, setWouldBuy] = useState<"yes" | "maybe" | "no" | null>(null);
  const [priceAnswer, setPriceAnswer] = useState("");
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-xl bg-accent-soft px-4 py-3 text-accent-text">
          Thanks. {email ? "We'll email you when it launches." : "Your answer was sent to the founder."}
        </p>
        <div className="rounded-xl border border-line px-4 py-3.5">
          <p className="font-medium">Got an idea of your own?</p>
          <p className="mt-0.5 text-[13px] text-ink-2">Shape it into a brand with Vybd, free, in about ten minutes.</p>
          <a href={`/login?ref=${encodeURIComponent(slug)}`} className="mt-3 inline-flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-white hover:opacity-90">
            Start your brand
          </a>
        </div>
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!wouldBuy) return setError("Pick an answer first.");
        start(async () => {
          const res = await submitFeedbackAction(slug, { wouldBuy, priceAnswer, comment, email });
          if (!res.ok) return setError(res.error);
          setDone(true);
        });
      }}
    >
      <fieldset>
        <legend className="sr-only">Would you buy this?</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`cursor-pointer rounded-full border px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                wouldBuy === o.value ? "border-focus bg-accent text-accent-ink" : "border-line hover:border-focus"
              }`}
            >
              <input type="radio" name="wouldBuy" value={o.value} className="sr-only" onChange={() => setWouldBuy(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">
          What would you pay for it?{price ? ` The founder is thinking ${price}.` : ""}
        </span>
        <input value={priceAnswer} onChange={(e) => setPriceAnswer(e.target.value)} className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-focus" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">Anything that would change your answer? (optional)</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-focus" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">Email, to hear when it launches (optional)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-focus" />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <button disabled={pending} className="h-10 rounded-full bg-accent px-5 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Sending…" : "Send answer"}
      </button>
    </form>
  );
}
