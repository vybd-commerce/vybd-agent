"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAuthCode, getClient, redirectUriAllowed } from "@/lib/oauth";

/** Re-validates the request from the form (never trust what the page rendered) and returns to the client. */
async function parse(formData: FormData) {
  const p = new URLSearchParams(String(formData.get("query") ?? ""));
  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  if (!client || !redirectUriAllowed(client.redirectUris, redirectUri)) throw new Error("Invalid client");
  const back = (params: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (p.get("state")) url.searchParams.set("state", p.get("state")!);
    return url.toString();
  };
  return { p, clientId, redirectUri, back };
}

export async function allowAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { p, clientId, redirectUri, back } = await parse(formData);
  const challenge = p.get("code_challenge");
  if (!challenge || p.get("code_challenge_method") !== "S256") throw new Error("PKCE required");
  const code = await createAuthCode({
    clientId,
    userId: session.user.id,
    redirectUri,
    codeChallenge: challenge,
    scope: p.get("scope") || "vybd",
    resource: p.get("resource"),
  });
  redirect(back({ code }));
}

export async function denyAction(formData: FormData) {
  const { back } = await parse(formData);
  redirect(back({ error: "access_denied" }));
}
