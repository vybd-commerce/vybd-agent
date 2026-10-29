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
      <p className="mt-6 rounded-xl bg-accent-soft px-4 py-3 text-accent">
        Thanks. {email ? "We'll email you when it launches." : "Your answer was sent to the founder."}
      </p>
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
              className={`cursor-pointer rounded-full border px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                wouldBuy === o.value ? "border-accent bg-accent text-white" : "border-line hover:border-accent"
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
        <input value={priceAnswer} onChange={(e) => setPriceAnswer(e.target.value)} className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">Anything that would change your answer? (optional)</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] text-ink-2">Email, to hear when it launches (optional)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-accent" />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <button disabled={pending} className="h-10 rounded-lg bg-accent px-5 font-medium text-white disabled:opacity-60">
        {pending ? "Sending…" : "Send answer"}
      </button>
    </form>
  );
}
