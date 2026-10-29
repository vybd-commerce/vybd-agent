import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { Wordmark } from "@/components/wordmark";
import { requireCtx } from "@/lib/session";

export default async function OpsLayout({ children }: LayoutProps<"/ops">) {
  const ctx = await requireCtx("/ops");
  if (ctx.role !== "operator") notFound();
  return (
    <div className="min-h-full">
      <LiveRefresh url="/api/ops/events" />
      <header className="flex h-14 items-center gap-3 border-b border-line px-4 md:px-6">
        <Link href="/ops" className="flex items-baseline gap-2">
          <Wordmark />
          <span className="text-[13px] text-ink-2">ops</span>
        </Link>
        <Link href="/" className="ml-auto text-[13px] text-ink-2 hover:text-ink">
          Back to app
        </Link>
      </header>
      <main className="mx-auto max-w-[1080px] px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
