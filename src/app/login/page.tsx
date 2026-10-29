import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { signInWithEmail, signInWithGoogle } from "@/app/actions";
import { Wordmark } from "@/components/wordmark";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/";
  const session = await auth();
  if (session?.user) redirect(next);
  const sent = params.sent === "1";

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[340px]">
        <Wordmark />
        <h1 className="mt-10 text-[22px] font-semibold tracking-[-0.01em]">
          {sent ? "Check your email" : "Start with an idea"}
        </h1>
        <p className="mt-2 text-ink-2">
          {sent
            ? "We sent you a sign-in link. In development it is printed in the server log."
            : "Sign in to shape a brand and keep its brief in one place."}
        </p>
        {!sent && (
          <div className="mt-8 space-y-3">
            {googleEnabled && (
              <form action={signInWithGoogle}>
                <input type="hidden" name="next" value={next} />
                <button className="h-10 w-full rounded-lg border border-line font-medium hover:bg-subtle">
                  Continue with Google
                </button>
              </form>
            )}
            <form action={signInWithEmail} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <label className="block">
                <span className="mb-1.5 block text-[13px] text-ink-2">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-10 w-full rounded-lg border border-line px-3 outline-none focus:border-accent"
                />
              </label>
              <button className="h-10 w-full rounded-lg bg-accent font-medium text-white hover:opacity-90">
                Email me a sign-in link
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
