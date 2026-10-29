import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validRedirectUri, verifyPkce } from "@/lib/oauth";

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
