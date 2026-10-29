import { appUrl } from "@/lib/stripe";

export default function ConnectPage() {
  const url = `${appUrl()}/api/mcp`;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-4 py-10 md:px-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Use Vybd in Claude or ChatGPT</h1>
        <p className="mt-2 text-ink-2">
          Connect Vybd as a custom connector and keep working on your brands from any AI assistant. It’s the same account:
          a brief you shape in Claude shows up here, and the other way round.
        </p>
        <section className="mt-8">
          <p className="text-[13px] text-ink-2">Connector URL</p>
          <p className="mt-1 rounded-lg bg-subtle px-3 py-2 font-mono text-[13px] break-all">{url}</p>
        </section>
        <section className="mt-8 space-y-4">
          <div>
            <h2 className="font-medium">Claude</h2>
            <p className="text-ink-2">Settings → Connectors → Add custom connector. Paste the URL and sign in with this account when asked.</p>
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
