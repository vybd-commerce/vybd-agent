import { registerClient } from "@/lib/oauth";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST" } });
}

/** RFC 7591 dynamic client registration, used by Claude, ChatGPT and other MCP hosts. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_client_metadata" }, { status: 400, headers: cors });
  const res = await registerClient(body);
  return Response.json(res, { status: "error" in res ? 400 : 201, headers: cors });
}
