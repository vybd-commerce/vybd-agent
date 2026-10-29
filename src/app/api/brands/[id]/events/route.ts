import { sql } from "@/db";
import { getBrand } from "@/lib/services/brands";
import { brandChannel } from "@/lib/services/events";
import { errorResponse } from "@/lib/http";
import { getCtx } from "@/lib/session";

export const maxDuration = 800;

/**
 * Live updates for one brand. Any surface (web chat, MCP, worker, ops console) that changes the brand
 * NOTIFYs its channel; this streams those notifications so the panel updates without reload.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/brands/[id]/events">) {
  const userCtx = await getCtx();
  if (!userCtx) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    await getBrand(userCtx, id);
  } catch (err) {
    return errorResponse(err);
  }

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
      const sub = await sql.listen(brandChannel(id), (payload) => send(payload));
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
      send(JSON.stringify({ type: "ready" }));
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
