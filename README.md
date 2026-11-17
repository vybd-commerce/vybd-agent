# Vybd Agent

Build a physical-product brand with your own AI agent. Vybd handles the supply chain. Part of [Vybd](https://www.vybd.ai).

Self-serve Vybd: founders shape a brand idea into a living Brand Brief through conversation, then buy real work on it (market snapshot, find suppliers) from Vybd agents backed by human operators. The same service layer powers the web chat and a remote MCP server, so a brief started in Claude or ChatGPT shows up live in the web app.

## Run it

```bash
pnpm install
cp .env.example .env.local      # then fill in AUTH_SECRET (openssl rand -base64 32) and ANTHROPIC_API_KEY
createdb vybd_agent             # or: docker compose up -d, and point DATABASE_URL at port 5433
pnpm db:migrate
pnpm dev                        # web app on :3000
pnpm worker                     # runs agent jobs (market snapshot); separate process
```

Sign in with any email: the magic link is printed in the `pnpm dev` log. Google sign-in turns on when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set.

Operators: add emails to `OPERATOR_EMAILS` (applied at sign-in) or run `pnpm make-operator you@example.com`. Operators get an Ops console link in the sidebar (`/ops`).

Payments: with `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set, paid jobs go through Stripe Checkout (`stripe listen --forward-to localhost:3000/api/stripe/webhook`). Without them, in development only, paid jobs open a local test checkout at `/dev/checkout/<jobId>` that charges nothing.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (uses a `vybd_agent_test` database, reset on every run; override with `TEST_DATABASE_URL`).

## How it fits together

```
 Web chat (/brands/[id])      MCP clients (Claude, ChatGPT)       Ops console (/ops)      Worker
        │  POST /api/chat             │  /api/mcp + OAuth                 │ server actions        │
        ▼                             ▼                                   ▼                       ▼
  orchestrator (Claude) ──►  src/lib/tools.ts  (one tool table)  ◄──────────────────────── job registry
                                      │
                                      ▼
                    src/lib/services/*   ← the only code that touches the database
                                      │                 │
                                  Postgres  ──NOTIFY──► /api/brands/[id]/events (SSE) → live panel
```

- `src/lib/brief.ts`: the frozen v1 brief schema (one-liner, customer, problem, positioning, price, channels, name directions, open questions). Usable = one-liner + customer + positioning.
- `src/lib/services/`: brands, versioned briefs (every write is a new `brief_versions` row with its source: chat, job, user_edit, mcp), conversations, jobs (state machine + events), share page and feedback. Every change NOTIFYs the brand's channel so all open surfaces update without reload.
- `src/lib/tools.ts`: `list_brands`, `create_brand`, `get_brand_brief`, `update_brand_brief`, `quote_job`, `approve_job`, `get_job`, `list_jobs`, `create_share_page`, `get_feedback`. Used verbatim by the web orchestrator and the MCP server.
- `src/lib/agent/`: orchestrator system prompt and interview script (`prompts.ts`), streaming tool loop (`orchestrator.ts`). The web agent also gets UI-only tools for quick-reply chips and next-step cards.
- `src/lib/jobs/`: job types. Each declares spec and result schemas, a quote, progress steps, an operator delivery form, an optional agent `run()`, and the chat summary posted on delivery. Add a type here and it works in chat, MCP, the worker and the ops console.
- `src/lib/mcp/` + `src/lib/oauth.ts`: Streamable HTTP MCP server with OAuth 2.1 (dynamic client registration, PKCE S256, refresh rotation). Signing in during OAuth creates the Vybd account if needed.

Job lifecycle: `draft → quoted → approved → in_progress → delivered → accepted` (plus `cancelled`, `failed`). Free jobs start on approval; paid jobs return a checkout link and start only when payment is confirmed. If the agent fails, the job lands in the ops queue and an operator can deliver it by hand.

## Decisions taken for the spec's open questions

These live in one place each and are easy to change:

- Market snapshot is free; Find suppliers is $149, 5 days (`src/lib/jobs/prices.ts`).
- The share page shows one-liner, problem, positioning and price by default; founders can toggle any field except open questions, which never go public (`brands.share_hidden_fields`, `src/lib/services/feedback.ts`).
- MCP users don't need a web account first: OAuth sign-in creates one.
- Model: `claude-opus-5-5` (override with `VYBD_MODEL`), with server-side refusal fallback enabled.
- In the web app, approving a paid job also goes through Stripe Checkout. Charging a saved card is deferred.

## Not in v1

See BACKLOG.md for planned follow-ups (first: "Continue with ChatGPT", so founders can run web chat on their ChatGPT plan).

Shopify store generation, Kickstarter, design jobs, team members, outside operators, mobile apps, emailing magic links (console only for now), email/Slack paging for ops (the console updates live and the server logs `[ops]` lines).

## Contributing

Read the [contributing guide](https://github.com/vybd-commerce/.github/blob/main/CONTRIBUTING.md) and `docs/TEAM_BRIEF.md`. Report security problems privately as described in [SECURITY.md](https://github.com/vybd-commerce/.github/blob/main/SECURITY.md).

## Licence

[Apache-2.0](LICENSE). The licence does not cover the Vybd name or logo.
