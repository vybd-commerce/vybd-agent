import { z } from "zod";
import { runChatTurn, type ChatEvent } from "@/lib/agent/orchestrator";
import { getMemberBrand } from "@/lib/services/brands";
import { ensureConversation } from "@/lib/services/conversations";
import { getCtx } from "@/lib/session";
import { errorResponse } from "@/lib/http";

export const maxDuration = 300;

const body = z.object({ brandId: z.string().uuid(), text: z.string().trim().min(1).max(8000) });

/** Streams one agent turn as server-sent events. */
export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "Sign in required" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { brandId, text } = parsed.data;
  try {
    await getMemberBrand(ctx, brandId);
  } catch (err) {
    return errorResponse(err);
  }
  const conversation = await ensureConversation(ctx, brandId, "web");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // client went away
        }
      };
      await runChatTurn({ ctx, brandId, conversationId: conversation!.id, text, emit, signal: req.signal });
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
