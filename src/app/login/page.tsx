import { redirect } from "next/navigation";
import { auth, emailEnabled, emailIsConsole, githubEnabled, googleEnabled } from "@/auth";
import { signInWithEmail, signInWithGitHub, signInWithGoogle } from "@/app/actions";
import { Wordmark } from "@/components/wordmark";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/";
  const session = await auth();
  if (session?.user) redirect(next);
  const sent = params.sent === "1";
  const waitlisted = params.waitlist === "1" || params.error === "AccessDenied";
  const failed = typeof params.error === "string" && !waitlisted;
  const ref = typeof params.ref === "string" ? params.ref : "";

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[340px]">
        <Wordmark />
        <h1 className="mt-10 text-[26px] font-display font-normal tracking-[-0.015em]">
          {waitlisted ? "You’re on the list" : sent ? "Check your email" : "Start with an idea"}
        </h1>
        <p className="mt-2 text-ink-2">
          {waitlisted
            ? "Vybd is in private beta. We saved your spot and will let you in soon. Got an invite link from a team? Open it and sign in from there."
            : sent
              ? emailIsConsole
                ? "We sent you a sign-in link. In development it is printed in the server log."
                : "We sent you a sign-in link. It works for one hour."
              : "Vybd is in private beta. It works inside Claude, ChatGPT and the AI tools you already use. Sign in once, then connect your assistant."}
        </p>
        {failed && (
          <p role="alert" className="mt-4 rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-2">
            Sign-in didn’t work. Try again, or use a different method.
          </p>
        )}
        {!sent && !waitlisted && (
          <div className="mt-8 space-y-3">
            {googleEnabled && (
              <form action={signInWithGoogle}>
                <input type="hidden" name="next" value={next} />
                <input type="hidden" name="ref" value={ref} />
                <button className="h-10 w-full rounded-lg border border-line font-medium hover:bg-subtle">
                  Continue with Google
                </button>
              </form>
            )}
            {githubEnabled && (
              <form action={signInWithGitHub}>
                <input type="hidden" name="next" value={next} />
                <input type="hidden" name="ref" value={ref} />
                <button className="h-10 w-full rounded-lg border border-line font-medium hover:bg-subtle">
                  Continue with GitHub
                </button>
              </form>
            )}
            {emailEnabled && (
            <form action={signInWithEmail} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="ref" value={ref} />
              <label className="block">
                <span className="mb-1.5 block text-[13px] text-ink-2">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-focus"
                />
              </label>
              <button className="h-10 w-full rounded-full bg-accent font-medium text-accent-ink hover:bg-accent-hover">
                Email me a sign-in link
              </button>
            </form>
            )}
            {!emailEnabled && !googleEnabled && !githubEnabled && (
              <p className="text-[13px] text-ink-3">Sign-in is not configured yet.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
