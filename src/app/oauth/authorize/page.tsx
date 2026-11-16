import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Wordmark } from "@/components/wordmark";
import { getClient, redirectUriAllowed } from "@/lib/oauth";
import { allowAction, denyAction } from "./actions";

type Params = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[360px]">
        <Wordmark />
        <h1 className="mt-8 text-[24px] font-display font-normal">Can’t connect</h1>
        <p className="mt-2 text-ink-2">{message}</p>
      </div>
    </main>
  );
}

/** OAuth consent: signs the user in (creating the account if new) and asks to connect the MCP client. */
export default async function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  const p: Params = await searchParams;
  const clientId = str(p.client_id);
  const redirectUri = str(p.redirect_uri);
  const challenge = str(p.code_challenge);
  const client = clientId ? await getClient(clientId) : null;

  if (!client) return <ErrorScreen message="This app isn’t registered with Vybd. Try adding the connector again." />;
  if (!redirectUriAllowed(client.redirectUris, redirectUri)) return <ErrorScreen message="The app sent an unexpected return address." />;
  if (str(p.response_type) !== "code" || !challenge || str(p.code_challenge_method) !== "S256") {
    return <ErrorScreen message="The app sent an incomplete sign-in request (PKCE S256 is required)." />;
  }

  const query = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);

  const name = client.name || "This app";
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <Wordmark />
        <h1 className="mt-8 text-[24px] font-display font-normal tracking-[-0.015em]">Connect {name} to Vybd</h1>
        <p className="mt-2 text-ink-2">
          {name} will be able to read and update your brands and briefs, quote jobs, and send you checkout links for paid work. It can’t pay for anything.
        </p>
        <p className="mt-4 text-[13px] text-ink-3">Signed in as {session.user.email}</p>
        <div className="mt-6 flex gap-2">
          <form action={allowAction} className="flex-1">
            <input type="hidden" name="query" value={query} />
            <button className="h-10 w-full rounded-full bg-accent font-medium text-accent-ink">Allow</button>
          </form>
          <form action={denyAction}>
            <input type="hidden" name="query" value={query} />
            <button className="h-10 rounded-lg border border-line px-4 font-medium">Cancel</button>
          </form>
        </div>
      </div>
    </main>
  );
}
