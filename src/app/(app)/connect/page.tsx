import { CopyCommand } from "@/components/copy-command";
import { appUrl } from "@/lib/stripe";

export default function ConnectPage() {
  const url = `${appUrl()}/api/mcp`;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-4 py-10 md:px-6">
        <h1 className="text-[26px] font-display font-normal tracking-[-0.015em]">Use Vybd in Claude, Codex or ChatGPT</h1>
        <p className="mt-2 text-ink-2">
          Connect Vybd as a custom connector and keep working on your brands from any AI assistant. It’s the same account:
          a brief you shape in Claude shows up here, and the other way round.
        </p>
        <section className="mt-8">
          <p className="text-[13px] text-ink-2">Connector URL</p>
          <CopyCommand text={url} />
        </section>
        <section className="mt-8 space-y-4">
          <div>
            <h2 className="font-medium">Claude</h2>
            <p className="text-ink-2">Settings → Connectors → Add custom connector. Paste the URL and sign in with this account when asked.</p>
          </div>
          <div>
            <h2 className="font-medium">Claude Code</h2>
            <p className="text-ink-2">
              Add the server, then run <code className="font-mono text-[13px]">/mcp</code> inside Claude Code and choose Vybd to sign in. Try{" "}
              <code className="font-mono text-[13px]">/mcp__vybd__brand_status</code> or{" "}
              <code className="font-mono text-[13px]">/mcp__vybd__run_market_snapshot</code>.
            </p>
            <Cmd>{`claude mcp add --transport http vybd ${url}`}</Cmd>
          </div>
          <div>
            <h2 className="font-medium">Codex CLI</h2>
            <p className="text-ink-2">Add the server, then sign in. A browser window opens for this account.</p>
            <Cmd>{`codex mcp add vybd --url ${url}\ncodex mcp login vybd`}</Cmd>
          </div>
          <div>
            <h2 className="font-medium">ChatGPT</h2>
            <p className="text-ink-2">Settings → Connectors → Create. Paste the URL, choose OAuth, and sign in with this account.</p>
          </div>
          <div>
            <h2 className="font-medium">Then</h2>
            <p className="text-ink-2">
              Ask it to start a brand interview, or to list your brands. Paid work always comes back as a checkout link you open yourself; nothing is charged from inside the assistant.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Cmd({ children }: { children: string }) {
  return <CopyCommand text={children} />;
}
