#!/usr/bin/env node
/**
 * vybd: Vybd from the terminal. A thin MCP client of <server>/api/mcp, so every command runs the
 * same tools and permission checks as Claude, Codex and the web app. Sign-in is the server's
 * OAuth flow (dynamic registration + PKCE) through a one-time listener on a free local port.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const VERSION = "0.1.0";
const SERVER = (process.env.VYBD_URL || "https://web-production-c9577.up.railway.app").replace(/\/$/, "");
const MCP_URL = `${SERVER}/api/mcp`;

// ---------- Credentials (one entry per server, file mode 600) ----------

type Saved = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; redirect?: string };
const DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "vybd");
const FILE = join(DIR, "credentials.json");

function readAll(): Record<string, Saved> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}
function load(): Saved {
  return readAll()[SERVER] ?? {};
}
function save(patch: Partial<Saved>) {
  const all = readAll();
  all[SERVER] = { ...all[SERVER], ...patch };
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

class FileAuth implements OAuthClientProvider {
  /** Set during `vybd login` to the local callback; other commands only refresh tokens. */
  constructor(private redirect?: string, private onAuthorize?: (url: URL) => void) {}
  get redirectUrl() {
    return this.redirect ?? load().redirect ?? "http://localhost/callback";
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Vybd CLI",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return load().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    save({ client, redirect: this.redirectUrl });
  }
  tokens() {
    return load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    save({ tokens });
  }
  saveCodeVerifier(verifier: string) {
    save({ verifier });
  }
  codeVerifier() {
    const v = load().verifier;
    if (!v) throw new Error("No sign-in in progress");
    return v;
  }
  redirectToAuthorization(url: URL) {
    if (!this.onAuthorize) throw new NotSignedIn();
    this.onAuthorize(url);
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "all" || scope === "client") save({ client: undefined });
    if (scope === "all" || scope === "tokens") save({ tokens: undefined });
    if (scope === "all" || scope === "verifier") save({ verifier: undefined });
  }
}

class NotSignedIn extends Error {
  constructor() {
    super("Not signed in. Run `vybd login`.");
  }
}

// ---------- Helpers ----------

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {}); // no browser opener; the URL is printed
    child.unref();
  } catch {
    // Printed below anyway.
  }
}

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = flags.has("--json");

function out(human: string, data: unknown) {
  console.log(asJson ? JSON.stringify(data, null, 2) : human);
}

function fail(message: string): never {
  console.error(`vybd: ${message}`);
  process.exit(1);
}

// ---------- MCP ----------

let client: Client | null = null;

async function mcp() {
  if (client) return client;
  if (!load().tokens) throw new NotSignedIn();
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: new FileAuth() });
  client = new Client({ name: "vybd-cli", version: VERSION });
  await client.connect(transport);
  return client;
}

/** Call a Vybd tool and return its JSON result (the last content block). */
async function call<T = unknown>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const res = await (await mcp()).callTool({ name, arguments: input });
  const blocks = (res.content ?? []) as { type: string; text?: string }[];
  const text = blocks.filter((b) => b.type === "text").pop()?.text ?? "";
  if (res.isError) fail(text || `${name} failed`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

type Brand = { id: string; name: string; stage: string; createdAt: string };
type Job = { id: string; title: string; status: string; price: string; checkoutUrl?: string; researchTask?: unknown };

/** By id, by name (case-insensitive prefix), or the most recent brand. */
async function resolveBrand(ref?: string): Promise<Brand> {
  const brands = await call<Brand[]>("list_brands");
  if (!brands.length) fail("No brands yet. Create one with `vybd new <name>`.");
  if (!ref) return brands[0];
  const lower = ref.toLowerCase();
  const hit =
    brands.find((b) => b.id === ref) ??
    brands.find((b) => b.name.toLowerCase() === lower) ??
    brands.find((b) => b.name.toLowerCase().startsWith(lower));
  if (!hit) fail(`No brand matches "${ref}". Run \`vybd brands\`.`);
  return hit;
}

const status = (s: string) => s.replace("_", " ");
const brandUrl = (id: string) => `${SERVER}/brands/${id}`;

// ---------- Commands ----------

async function login() {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback") return res.writeHead(404).end();
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>Vybd CLI</title><body style="font:16px system-ui;padding:48px">${
        code ? "Signed in. You can close this tab and go back to your terminal." : "Sign-in was cancelled."
      }</body>`,
    );
    if (code) resolveCode(code);
    else rejectCode(new Error(error === "access_denied" ? "Sign-in cancelled." : `Sign-in failed (${error ?? "no code"}).`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  // Registered as localhost; the server accepts any loopback port for the same host and path.
  const provider = new FileAuth(`http://localhost:${port}/callback`, (url) => {
    console.log(`Opening your browser to sign in to Vybd...\nIf it doesn't open, visit:\n${url}\n`);
    openBrowser(url.toString());
  });
  // A stored client registered for another redirect host would be rejected; start fresh.
  if (load().redirect && !load().redirect!.startsWith("http://localhost:")) save({ client: undefined });

  try {
    const first = await auth(provider, { serverUrl: MCP_URL });
    if (first !== "AUTHORIZED") {
      const timeout = setTimeout(() => rejectCode(new Error("Timed out waiting for sign-in.")), 5 * 60_000);
      const code = await codePromise.finally(() => clearTimeout(timeout));
      await auth(provider, { serverUrl: MCP_URL, authorizationCode: code });
    }
  } finally {
    server.close();
  }
  save({ verifier: undefined });
  const brands = await call<Brand[]>("list_brands");
  out(`Signed in to ${SERVER}. ${brands.length} brand${brands.length === 1 ? "" : "s"}.`, { server: SERVER, brands: brands.length });
}

function logout() {
  const all = readAll();
  delete all[SERVER];
  if (Object.keys(all).length) writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  else if (existsSync(FILE)) rmSync(FILE);
  out(`Signed out of ${SERVER}.`, { server: SERVER, signedIn: false });
}

async function whoami() {
  if (!load().tokens) return out(`Not signed in to ${SERVER}. Run \`vybd login\`.`, { server: SERVER, signedIn: false });
  const brands = await call<Brand[]>("list_brands");
  out(`Signed in to ${SERVER} · ${brands.length} brand${brands.length === 1 ? "" : "s"}`, { server: SERVER, signedIn: true, brands: brands.length });
}

async function brands() {
  const list = await call<Brand[]>("list_brands");
  out(list.length ? list.map((b) => `${b.name.padEnd(28)} ${b.stage.padEnd(9)} ${b.id}`).join("\n") : "No brands yet.", list);
}

async function newBrand(name?: string) {
  const b = await call<Brand>("create_brand", name ? { name } : {});
  out(`Created ${b.name}: ${brandUrl(b.id)}`, b);
}

type Brief = { version: number; usable: boolean; fields: Record<string, unknown>; pending?: string[] };

async function brief(ref?: string) {
  const b = await resolveBrand(ref);
  const res = await call<Brief>("get_brand_brief", { brandId: b.id });
  const rows = Object.entries(res.fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `  ${k.padEnd(16)} ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  out(
    [`${b.name} · brief v${res.version}${res.usable ? "" : " · not usable yet (needs oneLiner, customer, positioning)"}`, ...rows, `  ${brandUrl(b.id)}`].join("\n"),
    { brand: b, ...res },
  );
}

/** `vybd brief set price="$38 per kit" channels='["Shopify","TikTok"]' [--brand name]` */
async function briefSet(pairs: string[]) {
  const brandFlag = process.argv.find((a) => a.startsWith("--brand="))?.slice(8);
  const fields: Record<string, unknown> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 1) fail(`Expected field=value, got "${p}"`);
    const raw = p.slice(i + 1);
    let value: unknown = raw;
    if (/^[[{]/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        // keep as text
      }
    }
    fields[p.slice(0, i)] = value;
  }
  if (!Object.keys(fields).length) fail("Nothing to set. Example: vybd brief set price=\"$38 per kit\"");
  const b = await resolveBrand(brandFlag);
  const res = await call<{ version: number; changed: string[] }>("update_brand_brief", { brandId: b.id, fields });
  out(res.changed.length ? `${b.name} · brief v${res.version} · updated ${res.changed.join(", ")}` : "No changes.", res);
}

async function jobs(ref?: string) {
  const b = await resolveBrand(ref);
  const list = await call<Job[]>("list_jobs", { brandId: b.id });
  out(
    list.length ? list.map((j) => `${j.title.padEnd(20)} ${status(j.status).padEnd(12)} ${j.price.padEnd(8)} ${j.id}`).join("\n") : `${b.name} has no jobs yet.`,
    list,
  );
}

async function quote(type?: string) {
  if (!type) fail("Usage: vybd quote <market_snapshot|find_suppliers|brand_research> [--brand=name]");
  const b = await resolveBrand(process.argv.find((a) => a.startsWith("--brand="))?.slice(8));
  const j = await call<Job & { deliverable: string; etaDays: number }>("quote_job", { brandId: b.id, type });
  out(`${j.title} for ${b.name}: ${j.price}, about ${j.etaDays} day(s).\n${j.deliverable}\nApprove with: vybd approve ${j.id}`, j);
}

async function approve(jobId?: string) {
  if (!jobId) fail("Usage: vybd approve <jobId>");
  const j = await call<Job>("approve_job", { jobId });
  const lines = [`${j.title}: ${status(j.status)}`];
  if (j.checkoutUrl) lines.push(`Pay to start: ${j.checkoutUrl}`);
  if (j.researchTask) {
    lines.push(
      "This job runs in your AI assistant. In Claude Code or Codex (with Vybd connected) say: run my market snapshot.",
      "Not connected yet? Run `vybd install claude` or `vybd install codex`.",
    );
  }
  out(lines.join("\n"), j);
}

async function openBrand(ref?: string) {
  const url = ref || load().tokens ? brandUrl((await resolveBrand(ref)).id) : SERVER;
  openBrowser(url);
  out(url, { url });
}

function install(host?: string) {
  const run = (cmd: string, argv: string[]) => {
    console.log(`$ ${cmd} ${argv.join(" ")}`);
    const r = spawnSync(cmd, argv, { stdio: "inherit" });
    if (r.error) fail(`Couldn't run ${cmd}. Is it installed and on your PATH?`);
    if (r.status !== 0) fail(`${cmd} exited with ${r.status}`);
  };
  if (host === "claude") {
    run("claude", ["mcp", "add", "--transport", "http", "vybd", MCP_URL]);
    console.log("\nDone. In Claude Code run /mcp, choose vybd and sign in. Then try /mcp__vybd__brand_status.");
  } else if (host === "codex") {
    run("codex", ["mcp", "add", "vybd", "--url", MCP_URL]);
    run("codex", ["mcp", "login", "vybd"]);
    console.log("\nDone. Ask Codex: \"list my Vybd brands\".");
  } else {
    fail("Usage: vybd install <claude|codex>");
  }
}

const HELP = `vybd ${VERSION} · ${SERVER}

  vybd login                     Sign in (opens your browser)
  vybd logout                    Forget this machine's sign-in
  vybd whoami                    Show sign-in status

  vybd brands                    List your brands
  vybd new [name]                Create a brand
  vybd brief [brand]             Show a brand's brief (default: most recent)
  vybd brief set k=v ... [--brand=name]
                                 Update brief fields (JSON for lists: channels='["Shopify"]')
  vybd jobs [brand]              List jobs
  vybd quote <type> [--brand=name]  Quote market_snapshot, find_suppliers or brand_research
  vybd approve <jobId>           Approve a quoted job
  vybd open [brand]              Open the brand in the web app

  vybd install claude|codex      Connect Vybd to Claude Code or Codex

  --json                         Machine-readable output
  VYBD_URL=...                   Use another Vybd server`;

async function main() {
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "login":
      return login();
    case "logout":
      return logout();
    case "whoami":
      return whoami();
    case "brands":
      return brands();
    case "new":
      return newBrand(rest.join(" ") || undefined);
    case "brief":
      return rest[0] === "set" ? briefSet(rest.slice(1)) : brief(rest.join(" ") || undefined);
    case "jobs":
      return jobs(rest.join(" ") || undefined);
    case "quote":
      return quote(rest[0]);
    case "approve":
      return approve(rest[0]);
    case "open":
      return openBrand(rest.join(" ") || undefined);
    case "install":
      return install(rest[0]);
    case "version":
      return console.log(VERSION);
    case undefined:
    case "help":
      return console.log(HELP);
    default:
      if (flags.has("--version")) return console.log(VERSION);
      console.log(HELP);
      process.exit(1);
  }
}

main()
  .then(() => client?.close())
  .catch((err: unknown) => {
    if (err instanceof NotSignedIn || (err instanceof Error && err.name === "UnauthorizedError")) fail("Not signed in. Run `vybd login`.");
    fail(err instanceof Error ? err.message : String(err));
  });
