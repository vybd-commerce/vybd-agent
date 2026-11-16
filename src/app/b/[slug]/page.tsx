import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { Wordmark } from "@/components/wordmark";
import { BRIEF_LABELS, type BriefFieldKey } from "@/lib/brief";
import { getPublicPage } from "@/lib/services/feedback";

export async function generateMetadata({ params }: PageProps<"/b/[slug]">): Promise<Metadata> {
  const page = await getPublicPage((await params).slug);
  if (!page) return {};
  return { title: page.name, description: typeof page.fields.oneLiner === "string" ? page.fields.oneLiner : undefined };
}

const ORDER: BriefFieldKey[] = ["problem", "customer", "positioning", "channels", "nameDirections"];

export default async function SharePage({ params }: PageProps<"/b/[slug]">) {
  const page = await getPublicPage((await params).slug);
  if (!page) notFound();
  const f = page.fields;
  const price = typeof f.price === "string" ? f.price : null;

  return (
    <main className="mx-auto max-w-[600px] px-4 py-12 md:py-20">
      <h1 className="text-[36px] leading-[1.1] font-display font-normal tracking-[-0.015em] md:text-[44px]">{page.name}</h1>
      {f.oneLiner && <p className="mt-4 text-[18px] leading-snug text-ink-2">{String(f.oneLiner)}</p>}
      {price && <p className="mt-6 font-mono text-[15px]">{price}</p>}
      <dl className="mt-10 space-y-5">
        {ORDER.filter((k) => f[k] !== undefined).map((k) => (
          <div key={k}>
            <dt className="text-[13px] text-ink-3">{k === "problem" ? "The problem" : BRIEF_LABELS[k]}</dt>
            <dd className="mt-1 text-[15px] leading-relaxed">{Array.isArray(f[k]) ? (f[k] as string[]).join(", ") : String(f[k])}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-[24px] font-display font-normal tracking-[-0.015em]">Would you buy this?</h2>
        <p className="mt-1 text-ink-2">It’s an idea in progress. An honest answer helps more than a kind one.</p>
        <FeedbackForm slug={page.slug} price={price} />
      </section>
      <footer className="mt-16 flex items-center gap-2 text-[12px] text-ink-3">
        Made with <Wordmark className="!text-[13px] text-ink-2" />
      </footer>
    </main>
  );
}
