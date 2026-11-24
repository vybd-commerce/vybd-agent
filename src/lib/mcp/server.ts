import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { INTERVIEW_SCRIPT, JOBS_GUIDE } from "@/lib/agent/prompts";
import { BRIEF_LABELS, type BriefFieldKey } from "@/lib/brief";
import type { Ctx } from "@/lib/services/context";
import { logAgentActivity } from "@/lib/services/conversations";
import { appUrl } from "@/lib/stripe";
import { runTool, toolsFor } from "@/lib/tools";

const MCP_PREAMBLE = `You are working with Vybd, a workspace where founders shape brand ideas into a living Brand Brief and buy real work on it (market research, supplier sourcing) from Vybd agents and operators. The brief is saved in the founder's Vybd account and shows up live in the Vybd web app.

Start by calling list_brands. If the founder is describing a new idea, call create_brand with a working name; if it matches an existing brand, use that one. Then run the interview below, writing to the brief with update_brand_brief as you learn things.

Jobs that come back with researchTask run on you: say you're starting, do the research with your own web search, then call submit_job_result. Never invent competitors, prices or URLs.

The founder can open any brand in the Vybd web app at ${appUrl()}/brands/<brandId> to see the brief, jobs and team; mention it when it helps.

End every reply with one suggested next step the founder can say yes to. Once the brief is usable, offer: a market snapshot, a feedback page (create_share_page), finding suppliers, or inviting a friend to build it together (invite_member).`;

export function interviewPrompt(idea?: string) {
  return `${MCP_PREAMBLE}

${INTERVIEW_SCRIPT}

${JOBS_GUIDE}

Payments: approve_job returns a checkout link for paid jobs. Give the founder the link to open; never say a payment happened.${
    idea ? `\n\nThe founder's idea, in their words: ${idea}` : "\n\nAsk the founder what they're thinking of making."
  }`;
}

type Obj = Record<string, unknown>;
const brandLink = (id: unknown) => `${appUrl()}/brands/${String(id)}`;

/** One readable line ahead of the JSON, so CLI hosts (Claude Code, Codex) show something a person can scan. */
export function headline(tool: string, result: unknown): string | null {
  const r = (result ?? {}) as Obj;
  switch (tool) {
    case "list_brands": {
      const list = result as Obj[];
      if (!list.length) return "No brands yet.";
      return `${list.length} brand${list.length === 1 ? "" : "s"}: ${list.map((b) => `${b.name} (${b.stage})`).join(", ")}`;
    }
    case "create_brand":
      return `Created ${r.name}. Open it: ${brandLink(r.id)}`;
    case "get_brand_brief":
      return `Brief v${r.version}${r.usable ? " · usable" : " · still needs one-liner, customer and positioning"}`;
    case "update_brand_brief": {
      const changed = (r.changed as string[] | undefined) ?? [];
      return changed.length ? `Brief v${r.version} · updated ${changed.join(", ")}` : `Brief v${r.version} · no changes`;
    }
    case "quote_job":
    case "approve_job":
    case "get_job":
    case "submit_job_result": {
      const parts = [`${r.title}: ${String(r.status).replace("_", " ")}`, String(r.price ?? "")];
      if (r.checkoutUrl) parts.push(`pay: ${r.checkoutUrl}`);
      if (r.researchTask) parts.push("runs on you: research task below");
      if (r.appUrl) parts.push(`view: ${r.appUrl}`);
      return parts.filter(Boolean).join(" · ");
    }
    case "list_jobs": {
      const list = result as Obj[];
      return list.length ? list.map((j) => `${j.title}: ${String(j.status).replace("_", " ")}`).join("; ") : "No jobs yet.";
    }
    case "create_share_page":
    case "invite_member":
      return r.url ? String(r.url) : null;
    default:
      return null;
  }
}

/** Brand and one-line summary for a state-changing call, as teammates read it in the thread. Null skips the entry. */
export function activityLine(tool: string, args: unknown, result: unknown): { brandId: string; summary: string } | null {
  const a = (args ?? {}) as Obj;
  const r = (result ?? {}) as Obj;
  const brandId = String(a.brandId ?? r.brandId ?? r.id);
  switch (tool) {
    case "create_brand":
      return { brandId, summary: `Created the brand ${r.name}` };
    case "update_brand_brief": {
      const changed = (r.changed as BriefFieldKey[] | undefined) ?? [];
      if (!changed.length) return null;
      return { brandId, summary: `Updated the brief: ${changed.map((k) => BRIEF_LABELS[k] ?? k).join(", ")}` };
    }
    case "quote_job":
      return { brandId, summary: `Quoted ${r.title} · ${r.price}` };
    case "approve_job":
      return { brandId, summary: r.checkoutUrl ? `Approved ${r.title}, waiting on payment` : `Approved ${r.title}` };
    case "submit_job_result":
      return { brandId, summary: `Delivered ${r.title}` };
    case "create_share_page":
      return { brandId, summary: "Published the share page" };
    default:
      return null;
  }
}

/** Build an MCP server bound to one signed-in user. Tools are the same table the web agent uses. */
export function createMcpServer(ctx: Ctx, opts: { clientName?: string | null } = {}) {
  const client = opts.clientName?.trim() || "an AI agent";
  const server = new McpServer(
    { name: "vybd", version: "1.0.0" },
    { instructions: MCP_PREAMBLE },
  );

  for (const tool of toolsFor("mcp")) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (args: unknown) => {
        const res = await runTool(tool.name, args, { ctx, surface: "mcp" });
        if (!res.ok) return { content: [{ type: "text" as const, text: res.error }], isError: true };
        const activity = "writes" in tool && tool.writes ? activityLine(tool.name, args, res.result) : null;
        if (activity) {
          // The change already happened; a failed log must not make the agent retry it.
          await logAgentActivity(activity.brandId, { userId: ctx.userId, client, tool: tool.name, ...activity }).catch((err) =>
            console.error("MCP activity log failed", err),
          );
        }
        const line = res.headline ?? headline(tool.name, res.result);
        return {
          content: [
            ...(line ? [{ type: "text" as const, text: line }] : []),
            { type: "text" as const, text: JSON.stringify(res.result, null, 2) },
          ],
        };
      },
    );
  }

  server.registerPrompt(
    "start_brand_interview",
    {
      title: "Start a Vybd brand interview",
      description: "Shape a brand idea into a Vybd Brand Brief through a short interview.",
      argsSchema: { idea: z.string().optional().describe("The idea in the founder's own words") },
    },
    ({ idea }) => ({
      messages: [{ role: "user", content: { type: "text", text: interviewPrompt(idea) } }],
    }),
  );

  server.registerPrompt(
    "brand_status",
    {
      title: "Where is my brand?",
      description: "Summarize a brand's brief, gaps, jobs and the single best next step.",
      argsSchema: { brand: z.string().optional().describe("Brand name; defaults to the most recent") },
    },
    ({ brand }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${MCP_PREAMBLE}

Give me a short status of ${brand ? `my brand "${brand}"` : "my most recent brand"}: call list_brands, then get_brand_brief and list_jobs for it. Reply in under 120 words: what the brief says in one line, which fields are missing, what jobs are running or done, and the one next step you'd take. End with the web link ${appUrl()}/brands/<brandId>.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "run_market_snapshot",
    {
      title: "Run a market snapshot",
      description: "Research 5–10 competitors, a price band and the open lane for a brand, using your own web search.",
      argsSchema: { brand: z.string().optional().describe("Brand name; defaults to the most recent") },
    },
    ({ brand }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${MCP_PREAMBLE}

Run a market snapshot for ${brand ? `my brand "${brand}"` : "my most recent brand"}. Steps: list_brands, get_brand_brief (if it isn't usable yet, ask me the missing questions first), quote_job with type market_snapshot, then approve_job (I approve). If the job returns researchTask, do that research yourself with web search and call submit_job_result. If it's rejected, fix and resubmit. Finish with the open lane in one sentence and the web link.`,
          },
        },
      ],
    }),
  );

  return server;
}
