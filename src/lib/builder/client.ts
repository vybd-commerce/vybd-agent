import fs from "node:fs";
import { BRIEF_FIELDS, type BriefFieldKey, type BriefFields, isFilled } from "@/lib/brief";
import { DEMO_REPORT } from "@/lib/demo/script";
import { InvalidStateError, NotFoundError } from "@/lib/services/context";

/**
 * Client for the Vybd Brand Builder (Python, FastAPI), which owns the canonical brief and runs deep
 * brand research. Server-to-server only: one service token, acting as a builder user per call via
 * X-Vybd-Act-As. The agent does its own authorization (getMemberBrand) before any call.
 *
 * Every builder response is the envelope {ok, data, errors[{code, message, field}], ...}.
 * Endpoints marked (new) are not in the builder yet; see the integration plan, Part B.
 */

// Agent brief field <-> builder brief section.
export const SECTION_OF: Record<BriefFieldKey, string> = {
  oneLiner: "one_liner",
  customer: "customer",
  problem: "problem",
  alternative: "alternative",
  positioning: "positioning",
  competitors: "competitors",
  price: "product_price",
  channels: "channels",
  goals: "goals",
  nameDirections: "name_directions",
  openQuestions: "open_questions",
};
// The builder stores product_price in its `product` section; older builders return product/price as-is.
const FIELD_OF = {
  ...Object.fromEntries(Object.entries(SECTION_OF).map(([f, s]) => [s, f])),
  product: "price",
  price: "price",
} as Record<string, BriefFieldKey>;

export function toSections(fields: BriefFields): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of BRIEF_FIELDS) if (k in fields) out[SECTION_OF[k]] = fields[k] ?? "";
  return out;
}

// The builder keeps one claim per item and returns a lone claim as a string, several as a list.
const LIST_FIELDS = new Set<BriefFieldKey>(["competitors", "channels", "nameDirections", "openQuestions"]);

export function fromSections(sections: Record<string, unknown>): BriefFields {
  const out: Record<string, unknown> = {};
  for (const [s, v] of Object.entries(sections)) {
    const f = FIELD_OF[s];
    if (!f || !isFilled(v)) continue;
    if (LIST_FIELDS.has(f)) out[f] = Array.isArray(v) ? v : [v];
    else out[f] = Array.isArray(v) ? v.join("\n") : v;
  }
  return out as BriefFields;
}

export type BuilderRunStatus = "requested" | "approved" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type BuilderRun = { id: string; status: BuilderRunStatus; completedSteps: string[]; error: string | null };
export type BuilderProposal = { id: string; field: BriefFieldKey; value: string | string[]; rationale: string };

export interface BuilderApi {
  /** (new) POST /v1/service/users — upsert by email. */
  upsertUser(input: { email: string; name: string | null }): Promise<{ id: string }>;
  /** POST /v1/brands */
  createBrand(actAs: string, name: string): Promise<{ id: string }>;
  /** (new) GET /v1/brands/{id}/brief?format=fields */
  getBrief(actAs: string, brandId: string): Promise<{ version: number; fields: BriefFields }>;
  /** (new) PUT /v1/brands/{id}/brief/fields. Empty value clears a section. */
  putBrief(actAs: string, brandId: string, fields: BriefFields, source: string): Promise<{ version: number }>;
  /** GET /v1/brands/{id}/score */
  getScore(actAs: string, brandId: string): Promise<{ eligible: boolean; missing: BriefFieldKey[] }>;
  /** POST /v1/brands/{id}/runs */
  submitRun(actAs: string, brandId: string): Promise<BuilderRun>;
  /** GET /v1/runs/{id} */
  getRun(actAs: string, runId: string): Promise<BuilderRun>;
  /** POST /v1/runs/{id}/advance: the builder runs this run's next phases for up to `budgetS`, then returns it. */
  advanceRun(actAs: string, runId: string, budgetS: number): Promise<BuilderRun>;
  /** GET /v1/runs/{id}/report */
  getReport(actAs: string, runId: string): Promise<string>;
  /** GET /v1/brands/{id}/proposals?status=pending, filtered to one run. */
  listProposals(actAs: string, brandId: string, runId: string): Promise<BuilderProposal[]>;
  /** POST /v1/brands/{id}/proposals/{pid}/accept */
  acceptProposal(actAs: string, brandId: string, proposalId: string): Promise<void>;
}

export class BuilderError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
  /** Worth retrying later: builder down, or its model provider is. */
  get retryable() {
    return this.status >= 500 || this.status === 0;
  }
}

// Demo mode (VYBD_DEMO=1) uses the fake, saved to a file so it survives dev-server restarts.
const DEMO_FILE = ".demo-builder.json";
const fakeMode = () => process.env.BUILDER_MODE === "fake" || process.env.VYBD_DEMO === "1";

export function builderEnabled() {
  return fakeMode() || Boolean(process.env.BUILDER_API_URL);
}

// On globalThis so every route bundle in the dev server shares one fake.
const g = globalThis as { __vybdFakeBuilder?: FakeBuilder };

export function builder(): BuilderApi {
  if (fakeMode()) return (g.__vybdFakeBuilder ??= new FakeBuilder(process.env.VYBD_DEMO === "1" ? DEMO_FILE : undefined));
  return httpBuilder;
}

/** Tests: start from an empty fake builder. */
export function resetFakeBuilder() {
  g.__vybdFakeBuilder = new FakeBuilder();
  return g.__vybdFakeBuilder;
}

// ---------- HTTP ----------

type Envelope<T> = { ok: boolean; data: T; errors?: { code: string; message: string }[] };

async function call<T>(method: string, path: string, opts: { actAs?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const base = process.env.BUILDER_API_URL!.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${process.env.BUILDER_SERVICE_TOKEN ?? ""}`,
        "content-type": "application/json",
        ...(opts.actAs ? { "x-vybd-act-as": opts.actAs } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    throw new BuilderError(`Brand Builder unreachable: ${err instanceof Error ? err.message : String(err)}`, 0, "unreachable");
  }
  const env = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (res.ok && env?.ok) return env.data;
  const e = env?.errors?.[0];
  const message = e?.message ?? `Brand Builder ${method} ${path} failed (${res.status})`;
  if (res.status === 404) throw new NotFoundError(message);
  if (res.status === 409) throw new InvalidStateError(message);
  throw new BuilderError(message, res.status, e?.code ?? "unknown");
}

type RunOut = { id: string; status: BuilderRunStatus; completed_steps?: string[]; error?: string | null };
const toRun = (r: RunOut): BuilderRun => ({
  id: String(r.id),
  status: r.status,
  completedSteps: r.completed_steps ?? [],
  error: r.error ?? null,
});

const httpBuilder: BuilderApi = {
  async upsertUser({ email, name }) {
    const d = await call<{ user: { id: string } }>("POST", "/v1/service/users", { body: { email, display_name: name } });
    return { id: String(d.user.id) };
  },
  async createBrand(actAs, name) {
    const d = await call<{ brand: { id: string } }>("POST", "/v1/brands", { actAs, body: { name } });
    return { id: String(d.brand.id) };
  },
  async getBrief(actAs, brandId) {
    const d = await call<{ version: number; fields: Record<string, unknown> }>("GET", `/v1/brands/${brandId}/brief?format=fields`, { actAs });
    return { version: d.version, fields: fromSections(d.fields) };
  },
  async putBrief(actAs, brandId, fields, source) {
    return call<{ version: number }>("PUT", `/v1/brands/${brandId}/brief/fields`, {
      actAs,
      body: { fields: toSections(fields), source },
    });
  },
  async getScore(actAs, brandId) {
    const d = await call<{ score: { eligible: boolean; missing: string[] } }>("GET", `/v1/brands/${brandId}/score`, { actAs });
    return { eligible: d.score.eligible, missing: d.score.missing.map((s) => FIELD_OF[s]).filter(Boolean) };
  },
  async submitRun(actAs, brandId) {
    return toRun(await call<{ run: RunOut }>("POST", `/v1/brands/${brandId}/runs`, { actAs }).then((d) => d.run));
  },
  async getRun(actAs, runId) {
    return toRun(await call<{ run: RunOut }>("GET", `/v1/runs/${runId}`, { actAs }).then((d) => d.run));
  },
  async advanceRun(actAs, runId, budgetS) {
    const path = `/v1/runs/${runId}/advance?budget_s=${Math.floor(budgetS)}`;
    // The builder works for up to budgetS before answering; allow for its cold start too.
    return toRun(await call<{ run: RunOut }>("POST", path, { actAs, timeoutMs: (budgetS + 30) * 1000 }).then((d) => d.run));
  },
  async getReport(actAs, runId) {
    return (await call<{ report_md: string }>("GET", `/v1/runs/${runId}/report`, { actAs })).report_md;
  },
  async listProposals(actAs, brandId, runId) {
    const d = await call<{ proposals: { id: string; section: string; field?: string; value: string | string[]; rationale?: string; origin_ref?: string }[] }>(
      "GET",
      `/v1/brands/${brandId}/proposals?status=pending`,
      { actAs },
    );
    return d.proposals
      .map((p) => ({ ...p, key: FIELD_OF[p.field ?? p.section] }))
      .filter((p) => p.origin_ref === runId && p.key)
      .map((p) => ({ id: String(p.id), field: p.key, value: p.value, rationale: p.rationale ?? "" }));
  },
  async acceptProposal(actAs, brandId, proposalId) {
    await call("POST", `/v1/brands/${brandId}/proposals/${proposalId}/accept`, { actAs });
  },
};

// ---------- Fake (tests, local dev without the builder) ----------

export const RUN_STEPS = ["understand", "market_scan", "customer_insight", "opportunities", "focus_plan", "report"] as const;

export class FakeBuilder implements BuilderApi {
  users = new Map<string, string>(); // email -> id
  brands = new Map<string, { owner: string; name: string; version: number; fields: BriefFields }>();
  runs = new Map<string, { brandId: string; polls: number }>();
  proposals = new Map<string, BuilderProposal & { brandId: string; runId: string; status: string }>();
  private seq = 0;
  private nonce = Math.random().toString(36).slice(2, 8);

  constructor(private file?: string) {
    if (!file || !fs.existsSync(file)) return;
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    this.users = new Map(saved.users);
    this.brands = new Map(saved.brands);
    this.runs = new Map(saved.runs);
    this.proposals = new Map(saved.proposals);
    this.seq = saved.seq;
    this.nonce = saved.nonce;
  }
  private save() {
    if (!this.file) return;
    const { users, brands, runs, proposals, seq, nonce } = this;
    fs.writeFileSync(this.file, JSON.stringify({ users: [...users], brands: [...brands], runs: [...runs], proposals: [...proposals], seq, nonce }));
  }
  private id(prefix: string) {
    return `${prefix}_${this.nonce}_${++this.seq}`;
  }
  private brand(actAs: string, brandId: string) {
    const b = this.brands.get(brandId);
    if (!b || b.owner !== actAs) throw new NotFoundError("Brand not found");
    return b;
  }

  async upsertUser({ email }: { email: string }) {
    if (!this.users.has(email)) this.users.set(email, this.id("u"));
    this.save();
    return { id: this.users.get(email)! };
  }
  async createBrand(actAs: string, name: string) {
    const id = this.id("b");
    this.brands.set(id, { owner: actAs, name, version: 0, fields: {} });
    this.save();
    return { id };
  }
  async getBrief(actAs: string, brandId: string) {
    const b = this.brand(actAs, brandId);
    return { version: b.version, fields: { ...b.fields } };
  }
  async putBrief(actAs: string, brandId: string, fields: BriefFields) {
    const b = this.brand(actAs, brandId);
    const next = { ...b.fields, ...fields } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (!isFilled(next[k])) delete next[k];
    b.fields = next as BriefFields;
    b.version += 1;
    this.save();
    return { version: b.version };
  }
  async getScore(actAs: string, brandId: string) {
    const b = this.brand(actAs, brandId);
    const required: BriefFieldKey[] = ["oneLiner", "customer", "problem", "alternative", "positioning", "price", "channels", "goals"];
    const missing = required.filter((k) => !isFilled(b.fields[k]));
    return { eligible: missing.length === 0, missing };
  }
  async submitRun(actAs: string, brandId: string) {
    if (!(await this.getScore(actAs, brandId)).eligible) throw new InvalidStateError("Brief is not complete enough for a run");
    const id = this.id("r");
    this.runs.set(id, { brandId, polls: 0 });
    this.save();
    return { id, status: "queued" as const, completedSteps: [], error: null };
  }
  /** Each poll completes one more step; the last poll creates a proposal. */
  async getRun(actAs: string, runId: string) {
    const r = this.runs.get(runId);
    if (!r) throw new NotFoundError("Run not found");
    this.brand(actAs, r.brandId);
    r.polls = Math.min(r.polls + 1, RUN_STEPS.length);
    const done = r.polls === RUN_STEPS.length;
    if (done && ![...this.proposals.values()].some((p) => p.runId === runId)) {
      const id = this.id("p");
      this.proposals.set(id, { id, brandId: r.brandId, runId, status: "pending", field: "positioning", value: "The gentle daily ritual for thinning hair", rationale: "Customers describe competitors as clinical." });
    }
    this.save();
    return { id: runId, status: done ? ("completed" as const) : ("running" as const), completedSteps: RUN_STEPS.slice(0, r.polls), error: null };
  }
  async advanceRun(actAs: string, runId: string) {
    return this.getRun(actAs, runId);
  }
  async getReport() {
    return process.env.VYBD_DEMO === "1" ? DEMO_REPORT : "# Brand research\n\nFake report.";
  }
  async listProposals(actAs: string, brandId: string, runId: string) {
    this.brand(actAs, brandId);
    return [...this.proposals.values()]
      .filter((p) => p.runId === runId && p.status === "pending")
      .map(({ id, field, value, rationale }) => ({ id, field, value, rationale }));
  }
  async acceptProposal(actAs: string, brandId: string, proposalId: string) {
    const p = this.proposals.get(proposalId);
    if (!p || p.brandId !== brandId) throw new NotFoundError("Proposal not found");
    await this.putBrief(actAs, brandId, { [p.field]: p.value } as BriefFields);
    p.status = "accepted";
    this.save();
  }
}
