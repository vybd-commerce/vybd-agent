# Backlog

Work we decided to do later. Each entry is a ready-to-build plan.

## "Continue with ChatGPT" (use the founder's ChatGPT plan for web chat)

### Context
v1 is built (all 7 milestones). Web chat currently runs on our ANTHROPIC_API_KEY. User wants founders to bring their own subscription. Anthropic forbids subscription OAuth in third-party apps (consumer terms; enforced Jan–Apr 2026), so the Claude route stays the MCP connector we already have. OpenAI's Sign in with ChatGPT (SIWC, DevDay Sep 29 2026, docs at developers.openai.com/siwc) lets Plus/Pro users spend their plan allowance in third-party apps. Goal: founder clicks "Continue with ChatGPT", and their web chat turns run on their ChatGPT plan instead of our key.

Hard constraint: SIWC plan usage is self-serve only for open-source / locally hosted apps. A hosted multi-user app needs OpenAI approval (interest form: openai.com/form/sign-in-with-chatgpt-interest/). So: build it behind `SIWC_ENABLED`, test locally with a loopback redirect, ship to prod once OpenAI issues us a client_id. User step: submit the interest form now.

### Protocol facts (from official docs)
- Authorize `https://auth.openai.com/api/accounts/authorize`; token `https://auth.openai.com/api/accounts/oauth/token` (form-encoded).
- Params: `client_id` (`dynamic_agent_client` first time, then the issued `oaiapp_…` id), `agent_name_hint=Vybd` (first time only), `ext_agent_host_id` (stable per host), `response_type=code`, `redirect_uri` (loopback `http://127.0.0.1:…`, never `localhost`), `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`, `state`, `nonce`, PKCE S256. No client secret.
- Token response: access (1h), rotating refresh, id_token. Verify id_token via OpenAI JWKS (iss, aud = issued client_id, exp, nonce); require granted scope `chatgpt.tokens.use.direct`.
- Inference: `POST https://api.openai.com/v1/responses`, bearer = access token, `store:false` + `stream:true` mandatory, full history in `input` (no `previous_response_id`), system via `instructions`. Unsupported: `max_output_tokens`, `temperature`, `metadata`, `user`, hosted tools/MCP, etc. Function tools supported (docs say grouped in namespaces or `additional_tools` — confirm exact shape against docs page at implementation time). Models from `GET /v1/models` filtered `visibility == "list"`.
- Errors: 429 `subscription_sharing_usage_limit_exceeded` (may arrive as `response.failed` mid-stream) → pause, link `https://chatgpt.com/settings/usage`; refresh errors `invalid_grant`/`refresh_token_*` → disconnected.
- UX rules: button text "Continue with ChatGPT"; one-time welcome modal "You're using your ChatGPT plan" / "Got it"; "Using ChatGPT plan" + "Manage usage" link near composer; usage-limit UI with "Manage usage" as primary action.

### Design
**Identity stays as is** (magic link / Google). ChatGPT is a *model credential linked to a Vybd user*, not a login. Keeps auth simple and works for users who later disconnect.

**Data** — new table `model_credentials` (migration via drizzle-kit): user_id (unique per provider), provider `chatgpt`, client_id (issued), ext_agent_host_id, sub, email, access_token_enc, refresh_token_enc, expires_at, scopes text[], model (chosen slug), status `active|needs_reconnect`, welcomed_at, timestamps. Tokens AES-256-GCM encrypted with a key derived from AUTH_SECRET (`src/lib/crypto.ts`). Never logged.

**OAuth** — `src/lib/siwc.ts`: buildAuthorizeUrl (PKCE + state + nonce in short-lived httpOnly cookie), exchangeCode, verifyIdToken (`jose` createRemoteJWKSet), refreshIfNeeded (60s skew, row-locked so concurrent turns don't double-refresh a rotating token), listModels, disconnect. Routes: `GET /api/siwc/start`, `GET /api/siwc/callback` (requireCtx; stores credential; redirects back with `?chatgpt=connected`). Config: `SIWC_ENABLED`, `SIWC_CLIENT_ID` (set once OpenAI approves; otherwise dynamic registration), `SIWC_REDIRECT_URI` (dev default `http://127.0.0.1:3000/api/siwc/callback`), `SIWC_HOST_ID`.

**Provider-neutral orchestrator** — refactor `src/lib/agent/orchestrator.ts` so the loop (brand state, tool execution via `executeTool`, persistence, chips/next-steps, ChatEvents) is shared and the model call is behind an adapter:
```
interface ModelAdapter {
  step(input: { system, history: NeutralTurn[], tools: ToolSpec[], signal }, onText): Promise<{ toolCalls: {id,name,input}[], stop: "end"|"tool"|"refusal"|"cut_off" }>
  appendToolResults(...)   // provider-specific history items
}
```
- `src/lib/agent/adapters/anthropic.ts`: current code moved verbatim (FALLBACK_PARAMS, eager_input_streaming, pause_turn, refusal, JSON retry).
- `src/lib/agent/adapters/openai.ts`: `openai` npm SDK with `apiKey = access token`, `client.responses.create({ stream:true, store:false, instructions, input, tools })`; maps `response.output_text.delta` → text, `function_call` items → tool calls, `function_call_output` for results; validates tool args with the same zod schemas (`runTool` already does); maps 429 usage error to a typed `UsageLimitError`.
- Tool specs come from the existing `TOOLS`/`UI_TOOLS` + `jsonSchemaFor` in `src/lib/tools.ts`; each adapter formats them.
- `pickAdapter(ctx)`: active ChatGPT credential → OpenAI adapter with user's model; else ANTHROPIC_API_KEY → Anthropic; else error "Connect ChatGPT or set ANTHROPIC_API_KEY". No silent fallback from a failed ChatGPT turn to our key.
- New ChatEvent `{ type: "usage_limit" }` and `{ type: "provider", provider, model }`.

**Unchanged:** worker market-snapshot research stays on our Anthropic key (needs server web search; SIWC web search is "not guaranteed" and hosted tools are unsupported). MCP connector path unchanged.

**UI**
- `/settings` page (sidebar link): "Continue with ChatGPT" button (OpenAI approved button format), connected state (email, model picker from listModels, Disconnect, "Manage usage" link), needs-reconnect state.
- Composer footer: "Using ChatGPT plan · Manage usage" when active.
- One-time welcome modal after first connect (set `welcomed_at`).
- Usage-limit message card in conversation: primary "Manage usage" + secondary "Retry".
- `/connect` page: short note that Claude users connect via the connector (their Claude plan), ChatGPT users can either connect the app or Continue with ChatGPT.

### Files
New: `src/lib/siwc.ts`, `src/lib/crypto.ts`, `src/lib/agent/adapters/{types,anthropic,openai}.ts`, `src/app/api/siwc/{start,callback}/route.ts`, `src/app/(app)/settings/page.tsx`, `src/components/chatgpt-connect.tsx`, migration, tests.
Modified: `src/db/schema.ts`, `src/lib/agent/orchestrator.ts`, `src/app/api/chat/route.ts` (pick adapter), `src/components/conversation.tsx` + `brand-workspace.tsx` (usage badge, usage-limit card, welcome modal), `src/components/sidebar.tsx`, `src/app/actions.ts` (disconnect, set model), `.env.example`, README.
Deps: `openai`, `jose`.

### Verification
- Unit (vitest): token encrypt/decrypt round trip; PKCE + authorize URL params; callback rejects bad state/nonce/missing scope; refresh rotation + concurrent refresh with mocked fetch; OpenAI adapter maps a recorded Responses SSE fixture (text, function_call, response.failed 429) to neutral events; pickAdapter selection.
- Existing 21 tests + typecheck + lint stay green; Anthropic path re-checked (chat without key still returns the clear error).
- Manual (needs user's ChatGPT Plus/Pro account): open app at `http://127.0.0.1:3000` (loopback, same origin as redirect), Settings → Continue with ChatGPT → consent → back connected with model list; brand chat interview fills brief live via ChatGPT model; tool calls (update_brand_brief, quote_job) work; Disconnect returns to Anthropic/no-key message.
- Risk: OpenAI may refuse dynamic registration for a web callback without approval; if so, manual test waits for issued client_id, and adapter is verified via fixtures only.
