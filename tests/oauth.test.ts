import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redirectUriAllowed, validRedirectUri, verifyPkce } from "@/lib/oauth";

describe("PKCE", () => {
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  it("accepts the matching verifier", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a wrong or malformed verifier", () => {
    expect(verifyPkce(randomBytes(40).toString("base64url"), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https and loopback http only", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(validRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(validRedirectUri("http://evil.example/cb")).toBe(false);
    expect(validRedirectUri("https://x.com/cb#frag")).toBe(false);
    expect(validRedirectUri("not a url")).toBe(false);
  });
});

describe("loopback redirect ports", () => {
  const registered = ["http://localhost:5555/callback", "https://claude.ai/api/mcp/auth_callback"];

  it("accepts the exact URI or any port on the same loopback host and path", () => {
    expect(redirectUriAllowed(registered, "http://localhost:5555/callback")).toBe(true);
    expect(redirectUriAllowed(registered, "http://localhost:61234/callback")).toBe(true);
    expect(redirectUriAllowed(registered, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("rejects a different host, path or scheme", () => {
    expect(redirectUriAllowed(registered, "http://127.0.0.1:5555/callback")).toBe(false);
    expect(redirectUriAllowed(registered, "http://localhost:5555/other")).toBe(false);
    expect(redirectUriAllowed(registered, "https://localhost:5555/callback")).toBe(false);
    expect(redirectUriAllowed(registered, "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false);
    expect(redirectUriAllowed(registered, "not a url")).toBe(false);
  });
});
