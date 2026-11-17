# Vybd team brief

Read this first. It takes about 15 minutes. After it you should know what we are building, how the code is laid out, and how to pick up your first task.

- Task board: https://github.com/orgs/vybd-commerce/projects/11
- GitHub org: https://github.com/vybd-commerce
- Site: https://www.vybd.ai

---

## 1. What Vybd is

**Anyone can build a physical-product brand with their own AI agent. Vybd handles the supply chain once the brand is ready.**

A founder connects the agent they already use (Claude, ChatGPT, Codex, Cursor, or anything that speaks MCP) to Vybd. Together they work out positioning, research the market and define the product. Vybd keeps the shared record of the brand, so several people and several agents can work on it at once. When the brand passes a readiness check, the founder hands it to Vybd, and our operators and partners do sourcing, compliance, freight and fulfilment.

How we make money: supply chain margin, paid jobs (for example "find suppliers", $149), and later a share of task work done through the ecosystem. The software is the way in, not the product we charge for. That is why most of the code will be open source (Apache-2.0) and the supplier data, pricing and operations stay private.

## 2. The people who use it

| Who | What they do | Where |
|---|---|---|
| **Founder** | Shapes the brand with their agent, buys jobs, hands off to supply chain | Web app, or their own agent over MCP |
| **Team member** | Invited to a brand; owns a lane of work (for example Research) | Same |
| **Contributor** | Approved outsider who does small paid tasks for brands with their own agent (for example a site inspection) | `/work` in the app, or their agent over MCP |
| **Partner** | A service company (customs broker, 3PL, agency) listed in the directory; a kind of contributor | Applies on vybd.ai/ecosystem |
| **Operator** | Vybd staff. Delivers jobs by hand, approves contributors, runs supply chain handoffs | `/ops` console |

## 3. How it works

```
Founder + their agent                Vybd                           Vybd operators / contributors
─────────────────────                ────                           ─────────────────────────────
1. Interview        ──────────►  Brand Brief (versioned)
2. Research jobs    ──────────►  Jobs: quote → approve → run → deliver
   (market snapshot, positioning,        │
    customer research, naming)           ├── run by a Vybd agent, or
                                         ├── run by the founder's own agent, or
                                         └── delivered by an operator
3. Post small tasks ──────────►  Gig board  ───────────────────►  Contributor's agent claims,
                                                                   does the work, submits evidence
4. Readiness check passes
5. "Hand to Vybd"   ──────────►  Supply handoff ticket  ───────►  Operator starts sourcing
```

Brand stages: **Brief → Validate → Source → Store → Launch**. These three weeks cover Brief, Validate and the handoff into Source.

## 4. Words we use

- **Brand Brief**: the structured record of a brand: one-liner, customer, problem, positioning, price, channels, name directions, open questions. Every change is a new version with its source (chat, job, user edit, MCP). Schema: `src/lib/brief.ts`.
- **Tool**: one action an agent or the web chat can take (`update_brand_brief`, `quote_job`, …). All tools live in one table, `src/lib/tools.ts`, and are used unchanged by the web chat and the MCP server.
- **MCP**: Model Context Protocol. The standard way an outside AI agent calls our tools. Our server is at `/api/mcp`, with OAuth sign-in.
- **Job**: a unit of work with a price, a spec and a result. Lifecycle: `draft → quoted → approved → in_progress → delivered → accepted`. Job types are files in `src/lib/jobs/`.
- **Fulfiller**: who does a job: `agent`, `operator`, `hybrid`, and (new) `contributor`.
- **Gig / work request**: a job a brand posts for an outside contributor. Same jobs framework, with claim and review steps.
- **Lane**: an area of a brand's work that one member owns, with a checklist.
- **Host-run**: a job done by the founder's own agent, not by ours. We send the task; their agent returns the result through `submit_job_result`.
- **Brand Builder**: a separate Python service that does deep multi-phase research. The app calls it for the `brand_research` job.
- **Readiness**: the rules that decide a brand can be handed to supply chain.

## 5. What exists today

Built and working in `vybd-agent`:

- Web chat that interviews the founder and fills the brief live
- Remote MCP server with OAuth 2.1, tested with Claude, Claude Code, Codex and ChatGPT
- CLI (`cli/`) that wraps the same tools
- Jobs framework, Stripe checkout, ops console
- Market snapshot job (free, automated), find suppliers job ($149, delivered by an operator)
- Invites, owner and member roles, public share page with feedback, Brand Score

Missing, and what the next three weeks build:

- Lanes and team tasks; agent activity visible to teammates; scoped agent permissions
- Real research: positioning, customer research, naming. Brand Builder's web search is currently fake.
- Products as data, readiness check, supply chain handoff
- The ecosystem: contributor applications, gig board, work tools for agents, scorecard, reward ledger
- CI, staging, end-to-end tests, evals, onboarding, docs

## 6. Architecture in one picture

```
 Web chat            MCP clients (any agent)        Ops console           Worker
 /brands/[id]        /api/mcp + OAuth               /ops                  pnpm worker
     │                     │                          │                      │
     ▼                     ▼                          ▼                      ▼
 orchestrator ───►  src/lib/tools.ts  (one tool table)  ◄──────────────  job registry
                           │                                             src/lib/jobs/
                           ▼
                  src/lib/services/*   ← the only code that touches the database
                           │
                       Postgres ──NOTIFY──► live updates to every open screen
                           │
                  Brand Builder (Python, separate repo) for deep research
```

Rules that keep this simple:

1. **Only `src/lib/services/` touches the database.** Routes, tools and the worker call services.
2. **A new capability is a new tool in `src/lib/tools.ts`.** It then works in web chat, MCP and the CLI at once.
3. **A new kind of work is a new job type in `src/lib/jobs/`.** It then works in chat, MCP, the worker and the ops console.
4. **Every change notifies the brand's channel** so open screens update without reload.

Stack: Next.js 16, React 19, Drizzle + Postgres, Auth.js, Anthropic SDK, MCP SDK, Stripe, Tailwind 4, vitest. Hosted on Railway (web and worker) with Neon Postgres.

> Next.js 16 differs from older versions. Read `AGENTS.md` before writing route or config code, and tell your coding agent to do the same.

## 7. Repositories

| Repo | What | Status |
|---|---|---|
| `vybd-agent` | The product: web app, MCP server, worker, CLI, ecosystem | Being pushed to GitHub (task F1) |
| `vybd-brand-builder` | Python research service | Being pushed to GitHub (task F2) |
| `vybd` | The vybd.ai website, including `/ecosystem` | On GitHub |
| `skills` | Open source agent skills for building storefronts | On GitHub |

Other repos in the org are client storefronts or archived prototypes. You can ignore them.

## 8. Run it locally

```bash
pnpm install
cp .env.example .env.local      # set AUTH_SECRET (openssl rand -base64 32)
docker compose up -d            # Postgres on port 5433; point DATABASE_URL at it
pnpm db:migrate
pnpm demo                       # scripted demo, no API keys needed
```

Then, with real keys: `pnpm dev` (web on :3000) and `pnpm worker` (runs jobs). Sign in with any email; the magic link prints in the `pnpm dev` log. To see the ops console: `pnpm make-operator you@example.com`.

Checks before every pull request: `pnpm typecheck && pnpm lint && pnpm test`.

**Do this once, whatever your role:** run the demo, create a brand, finish the interview, run a market snapshot, then connect your own agent from the `/connect` page and change the brief from it. Watch the web page update. That is the product.

## 9. Where to start, by background

**Product**
1. Open the four mockups in the private [vybd-product](https://github.com/vybd-commerce/vybd-product) repo (`mockups/1-shape-the-brand` to `4-build-together`).
2. Read `SPEC.md` in vybd-product, and `docs/collaboration-user-stories.md` here.
3. Read https://www.vybd.ai/ecosystem; it is the promise the ecosystem work must keep.
4. On the board, read every P0 "Done when" list. Those are the acceptance tests. Challenge any that do not match what a user needs.

**Software engineer**
1. `README.md`, then `src/lib/tools.ts` and one service, for example `src/lib/services/jobs.ts`.
2. `src/db/schema.ts` for the data model.
3. `src/lib/jobs/registry.ts` and `src/lib/jobs/market-snapshot.ts` to see a full job type.
4. `src/lib/mcp/server.ts` and `src/lib/oauth.ts` for how outside agents get in.
5. `tests/` for the patterns we expect (real Postgres, no mocks of the database).

**AI / ML**
1. `src/lib/agent/prompts.ts` (interview script, system prompt) and `src/lib/agent/orchestrator.ts` (streaming tool loop).
2. `src/lib/jobs/market-snapshot.ts`: research with web search and a forced, schema-checked result.
3. `src/lib/builder/client.ts`, then the Brand Builder repo: `packages/runner/src/runner/phases/` and `content/challenges/brief_v1/`.
4. Note: there are no evals yet. Tasks Q2 and Q5 create them. Until then, be careful changing prompts.

## 10. The plan

| Week | Friday demo |
|---|---|
| **1** (Nov 16–20) | Code is on GitHub with CI and staging. Two people, each with their own agent, work on one brand: they claim lanes, the agent flags unowned work, and every agent action shows in the thread. |
| **2** (Nov 23–27) | A brand reaches "ready" on real research and is handed to Vybd supply chain. Separately, a brand posts a site inspection, a contributor's agent claims it over MCP, submits evidence, and the brand accepts. |
| **3** (Nov 30–Dec 4) | A stranger signs up, connects their agent and builds a brief. A second stranger applies as a contributor, is approved and completes a task. No engineer helps. |

Out of scope for now: paying contributors through the app (rewards are recorded and paid by hand), Shopify store and Kickstarter stages, "Continue with ChatGPT", Autopilot.

## 11. How to use the board

Each task has:

- **Task ID**: letter and number. F = Foundation, C = Collaboration, A = Agent access, R = Research, S = Supply handoff, E = Ecosystem, Q = Quality.
- **Week**: which weekly deliverable it belongs to.
- **Priority**: P0 is required for the Friday demo. P1 ships if there is time. P2 is nice to have.
- **Skill**: Frontend, Backend, AI or Ops. A hint about who is best placed to do it, not an assignment.
- **Body**: Goal, Where (files), Done when (checklist).

To work:

1. Filter the board to the current week and your skill. Take a P0 that is assigned to you, or ask for one.
2. Move it to **In progress**. If the "Done when" list is unclear or wrong, say so in the task before you build.
3. Branch, build, add tests. Open a pull request that links the task. Move it to **In review**.
4. It is **Done** when it is merged and every "Done when" box is true on staging.

Suggested order when things are tight: F1–F4, then A1 A2 C1–C4, then R1 R2 R4, then S1–S4, then E1 E4–E8.

Tasks are draft items until the repositories exist on GitHub; they become issues after F1 and F2.

## 12. Ways of working

- Small pull requests, one task each. One review required.
- Never commit secrets, API keys, or customer or supplier data. Most of this code will be public.
- Add a test for behaviour you change. The suite uses a real `vybd_agent_test` database.
- If you use a coding agent, point it at `AGENTS.md` and this brief.
- Friday: demo the week's sentence from section 10, live, on staging.

## 13. Not decided yet

These are open with the founder. Ask before you build on an assumption about them.

- Web search provider and model budget for research (R1, R3)
- Exact readiness rules and what the handoff promises the founder (S2, S4)
- Who pays gig rewards during beta and the default reward per task type (E5, E12)
- Criteria for approving a contributor (E4)
- Production domain for the app (A8); storage and email providers (E9, A10)
- Which parts of `vybd-agent` stay private when the repo goes public
