import { exchangeToken } from "@/lib/oauth";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST" } });
}

function basicAuth(header: string | null) {
  const m = header?.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  const [id, secret] = Buffer.from(m[1], "base64").toString().split(":");
  return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(secret ?? "") } : null;
}

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const params = type.includes("application/json")
    ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await req.text());
  const res = await exchangeToken(params, basicAuth(req.headers.get("authorization")));
  const status = "error" in res ? (res.error === "invalid_client" ? 401 : 400) : 200;
  return Response.json(res, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}
