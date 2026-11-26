import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { hasConnectedAssistant } from "@/lib/oauth";
import { listBrands } from "@/lib/services/brands";
import { requireCtx } from "@/lib/session";
import { appUrl } from "@/lib/stripe";

/** What to say once connected. The first three match the server's MCP prompts. */
const THINGS_TO_SAY = [
  "Start a Vybd brand interview. My idea: …",
  "Where is my Vybd brand at, and what should I do next?",
  "Run a Vybd market snapshot for my brand.",
  "Make a Vybd feedback page for my brand.",
];

/** The main onboarding page: Vybd has no chat of its own, so everything starts in the founder's assistant. */
export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const ctx = await requireCtx("/connect");
  const [connected, brands, params] = await Promise.all([hasConnectedAssistant(ctx.userId), listBrands(ctx), searchParams]);
  const url = `${appUrl()}/api/mcp`;
  const wantsNew = params.new === "1";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-4 py-10 md:px-6">
        <h1 className="text-[28px] font-display font-normal tracking-[-0.015em]">Vybd works inside the AI you already use</h1>
        <p className="mt-2 text-ink-2">
          Connect Vybd to Claude, ChatGPT, Gemini or any assistant that supports MCP. Your assistant interviews you, builds the brand brief and runs
          the work; this site keeps the brief, jobs and team in one place, and updates live while it works.
        </p>

        {connected ? (
          <section className="mt-6 rounded-xl border border-ok/40 bg-bg px-4 py-3.5" aria-label="Connection">
            <p className="font-medium">
              <span className="text-ok">✓</span> Assistant connected
            </p>
            {wantsNew ? (
              <p className="mt-1 text-[13px] text-ink-2">To start a new brand, ask your assistant: “Start a Vybd brand interview.” It shows up here as soon as it’s created.</p>
            ) : brands.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {brands.map((b) => (
                  <li key={b.id}>
                    <Link href={`/brands/${b.id}`} className="rounded-full border border-line-strong px-3 py-1 text-[13px] hover:border-focus hover:text-accent-text">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-ink-2">Ask it to start a brand interview. Your first brand appears here once it’s created.</p>
            )}
          </section>
        ) : null}

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["1", "Add Vybd", "Paste the connector URL into your assistant."],
            ["2", "Sign in", "Your assistant opens Vybd once; sign in with this account."],
            ["3", "Say what you’re making", "“Start a Vybd brand interview.”"],
          ].map(([n, title, body]) => (
            <li key={n} className="rounded-xl border border-line bg-bg px-3.5 py-3">
              <p className="font-mono text-[11px] text-ink-3">STEP {n}</p>
              <p className="mt-0.5 font-medium">{title}</p>
              <p className="text-[13px] text-ink-2">{body}</p>
            </li>
          ))}
        </ol>

        <section className="mt-8">
          <p className="text-[13px] text-ink-2">Connector URL</p>
          <CopyCommand text={url} />
        </section>

        <section className="mt-8 space-y-6">
          <Client name="Claude (web and desktop)">
            Settings → Connectors → Add custom connector. Paste the URL, then sign in when asked. Works on paid Claude plans.
          </Client>
          <Client name="ChatGPT">
            Settings → Apps &amp; Connectors → turn on developer mode, then Create. Paste the URL, choose OAuth, and sign in.
          </Client>
          <Client name="Claude Code" cmd={`claude mcp add --transport http vybd ${url}`}>
            Add the server, then run <Code>/mcp</Code>, choose vybd and sign in. Try <Code>/mcp__vybd__start_brand_interview</Code>.
          </Client>
          <Client name="Gemini CLI" cmd={`gemini mcp add --transport http vybd ${url}`}>
            Add the server, then run <Code>/mcp auth vybd</Code> inside Gemini CLI to sign in. The Gemini app doesn’t support custom connectors yet; use Gemini CLI.
          </Client>
          <Client name="Codex CLI" cmd={`codex mcp add vybd --url ${url}\ncodex mcp login vybd`}>
            Add the server, then sign in. A browser window opens for this account.
          </Client>
          <Client name="Cursor" cmd={JSON.stringify({ mcpServers: { vybd: { url } } }, null, 2)}>
            Add this to <Code>~/.cursor/mcp.json</Code> (or Settings → MCP → Add), then click Connect to sign in.
          </Client>
          <Client name="Any other MCP client">
            Use the URL above with the Streamable HTTP transport. Sign-in is OAuth 2.1 with dynamic client registration, so no keys to copy.
          </Client>
        </section>

        <section className="mt-10">
          <h2 className="font-medium">Things to say</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">Copy one into your assistant once it’s connected.</p>
          <div className="mt-1 space-y-1">
            {THINGS_TO_SAY.map((t) => (
              <CopyCommand key={t} text={t} />
            ))}
          </div>
          <p className="mt-4 text-[13px] text-ink-3">
            Paid work always comes back as a checkout link you open yourself; nothing is charged from inside the assistant.
          </p>
        </section>
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return <code className="font-mono text-[13px]">{children}</code>;
}

function Client({ name, cmd, children }: { name: string; cmd?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-medium">{name}</h2>
      <p className="text-ink-2">{children}</p>
      {cmd && <CopyCommand text={cmd} />}
    </div>
  );
}
