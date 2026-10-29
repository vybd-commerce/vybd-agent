import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { appUrl } from "@/lib/stripe";
import { verifyAccessToken } from "@/lib/oauth";
import { ctxForUser } from "@/lib/services/context";

export const maxDuration = 300;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

function unauthorized() {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource/api/mcp"`,
    },
  });
}

/** Remote MCP endpoint (Streamable HTTP, stateless). Same accounts and service layer as the web app. */
async function handle(req: Request) {
  const token = await verifyAccessToken(req.headers.get("authorization"));
  if (!token) return unauthorized();
  const ctx = await ctxForUser(token.userId).catch(() => null);
  if (!ctx) return unauthorized();

  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" } });
}
