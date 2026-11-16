import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { acceptInviteAction } from "@/app/actions";
import { Wordmark } from "@/components/wordmark";
import { previewInvite } from "@/lib/services/invites";

export async function generateMetadata({ params }: PageProps<"/join/[token]">): Promise<Metadata> {
  const invite = await previewInvite((await params).token);
  if (invite.status !== "ok") return { title: "Invite expired" };
  return {
    title: `Join ${invite.brandName} on Vybd`,
    description: `${invite.inviterName} invited you to build ${invite.brandName} together.`,
  };
}

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const [invite, session] = await Promise.all([previewInvite(token), auth()]);

  if (invite.status !== "ok") {
    return (
      <main className="mx-auto max-w-[440px] px-4 py-16 md:py-24">
        <Wordmark />
        <h1 className="mt-10 text-[26px] font-display font-normal tracking-[-0.015em]">This invite link has expired</h1>
        <p className="mt-2 text-ink-2">Invite links last 7 days, and the owner can reset them. Ask whoever sent it for a new one.</p>
        <Link href="/" className="mt-8 inline-flex h-10 items-center rounded-lg border border-line px-4 font-medium hover:bg-subtle">
          Go to Vybd
        </Link>
      </main>
    );
  }

  const join = acceptInviteAction.bind(null, token);
  return (
    <main className="mx-auto max-w-[440px] px-4 py-16 md:py-24">
      <Wordmark />
      <p className="mt-10 text-[13px] text-ink-3">{invite.inviterName} invited you to build</p>
      <h1 className="mt-1 text-[36px] leading-[1.1] font-display font-normal tracking-[-0.015em]">{invite.brandName}</h1>
      {invite.oneLiner && <p className="mt-3 text-[17px] leading-snug text-ink-2">{invite.oneLiner}</p>}

      <div className="mt-6 flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {invite.members.slice(0, 5).map((m, i) => (
            <Avatar key={i} name={m.name} image={m.image} />
          ))}
        </div>
        <span className="text-[13px] text-ink-2">
          {invite.members.length === 1 ? "1 person" : `${invite.members.length} people`} on the team
        </span>
      </div>

      <p className="mt-8 text-ink-2">
        You’ll share one thread and one Brand Brain with the team and the Vybd agent. Anyone can shape the brief; the owner approves anything paid.
      </p>

      {session?.user ? (
        <form action={join} className="mt-8">
          <button className="h-11 w-full rounded-full bg-accent font-medium text-accent-ink hover:bg-accent-hover">Join {invite.brandName}</button>
        </form>
      ) : (
        <Link
          href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
          className="mt-8 flex h-11 w-full items-center justify-center rounded-full bg-accent font-medium text-accent-ink hover:bg-accent-hover"
        >
          Sign in to join
        </Link>
      )}
    </main>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name} className="h-7 w-7 rounded-full border-2 border-bg object-cover" />;
  }
  return (
    <span
      title={name}
      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-subtle text-[11px] font-semibold text-ink-2"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
