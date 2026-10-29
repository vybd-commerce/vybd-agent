import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl } from "@/lib/stripe";

// Minimal OAuth 2.1 authorization server for MCP clients: dynamic client registration,
// authorization code + PKCE (S256), refresh token rotation. Tokens are stored hashed.

export const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 60 * 60 * 24 * 30;
const CODE_TTL_S = 5 * 60;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

export function mcpResourceUrl() {
  return `${appUrl()}/api/mcp`;
}

export function authServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["vybd"],
  };
}

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [appUrl()],
    scopes_supported: ["vybd"],
    bearer_methods_supported: ["header"],
    resource_name: "Vybd",
  };
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validRedirectUri(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    // https anywhere; http only for loopback (local MCP clients such as the inspector).
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

export async function registerClient(input: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown }) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || !uris.every(validRedirectUri)) {
    return { error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or http on localhost)" } as const;
  }
  const method = input.token_endpoint_auth_method === undefined ? "none" : String(input.token_endpoint_auth_method);
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    return { error: "invalid_client_metadata", error_description: "unsupported token_endpoint_auth_method" } as const;
  }
  const id = `vybd_${randomBytes(12).toString("hex")}`;
  const secret = method === "none" ? null : token("vcs");
  const name = typeof input.client_name === "string" ? input.client_name.slice(0, 100) : null;
  await db.insert(schema.oauthClients).values({ id, name, redirectUris: uris, secretHash: secret ? sha256(secret) : null });
  return {
    client_id: id,
    ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name ?? undefined,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

export async function getClient(clientId: string) {
  return db.query.oauthClients.findFirst({ where: eq(schema.oauthClients.id, clientId) });
}

export async function createAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string | null;
  resource?: string | null;
}) {
  const code = token("vac");
  await db.insert(schema.oauthCodes).values({
    code: sha256(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope ?? null,
    resource: input.resource ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
  });
  return code;
}

async function issueTokens(clientId: string, userId: string, scope: string | null) {
  const access = token("vat");
  const refresh = token("vrt");
  await db.insert(schema.oauthTokens).values({
    accessTokenHash: sha256(access),
    refreshTokenHash: sha256(refresh),
    clientId,
    userId,
    scope,
    expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scope ?? "vybd" };
}

type TokenError = { error: string; error_description?: string };

function checkClientSecret(client: { secretHash: string | null }, secret: string | null): boolean {
  if (!client.secretHash) return true;
  return Boolean(secret) && sha256(secret!) === client.secretHash;
}

export async function exchangeToken(params: URLSearchParams, basicAuth: { id: string; secret: string } | null): Promise<TokenError | Awaited<ReturnType<typeof issueTokens>>> {
  const clientId = basicAuth?.id ?? params.get("client_id");
  if (!clientId) return { error: "invalid_client" };
  const client = await getClient(clientId);
  if (!client || !checkClientSecret(client, basicAuth?.secret ?? params.get("client_secret"))) return { error: "invalid_client" };

  const grant = params.get("grant_type");
  if (grant === "authorization_code") {
    const code = params.get("code");
    const verifier = params.get("code_verifier");
    if (!code || !verifier) return { error: "invalid_request" };
    // Single use: delete as we read it.
    const [row] = await db.delete(schema.oauthCodes).where(eq(schema.oauthCodes.code, sha256(code))).returning();
    if (!row || row.clientId !== clientId || row.expiresAt < new Date()) return { error: "invalid_grant" };
    if (params.get("redirect_uri") && params.get("redirect_uri") !== row.redirectUri) return { error: "invalid_grant" };
    if (!verifyPkce(verifier, row.codeChallenge)) return { error: "invalid_grant", error_description: "PKCE check failed" };
    return issueTokens(clientId, row.userId, row.scope);
  }

  if (grant === "refresh_token") {
    const refresh = params.get("refresh_token");
    if (!refresh) return { error: "invalid_request" };
    const [row] = await db
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date(), refreshTokenHash: null })
      .where(and(eq(schema.oauthTokens.refreshTokenHash, sha256(refresh)), isNull(schema.oauthTokens.revokedAt)))
      .returning();
    if (!row || row.clientId !== clientId || row.createdAt.getTime() + REFRESH_TTL_S * 1000 < Date.now()) {
      return { error: "invalid_grant" };
    }
    return issueTokens(clientId, row.userId, row.scope);
  }

  return { error: "unsupported_grant_type" };
}

/** Bearer token → user id, or null if missing, unknown, expired or revoked. */
export async function verifyAccessToken(bearer: string | null) {
  const m = bearer?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const row = await db.query.oauthTokens.findFirst({
    where: and(
      eq(schema.oauthTokens.accessTokenHash, sha256(m[1].trim())),
      isNull(schema.oauthTokens.revokedAt),
      gt(schema.oauthTokens.expiresAt, new Date()),
    ),
  });
  return row ? { userId: row.userId, clientId: row.clientId } : null;
}
