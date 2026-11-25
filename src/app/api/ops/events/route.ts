import { listen } from "@/db";
import { OPS_CHANNEL } from "@/lib/services/events";
import { getCtx } from "@/lib/session";

export const maxDuration = 300; // Vercel Hobby cap; clients reconnect and catch up on "ready".

/** Live job changes for the ops console. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || ctx.role !== "operator") return new Response("Forbidden", { status: 403 });
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };
      const sub = await listen(OPS_CHANNEL, send);
      const ping = setInterval(() => send(JSON.stringify({ type: "ping" })), 25_000);
      cleanup = () => {
        clearInterval(ping);
        sub.unlisten().catch(() => {});
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
