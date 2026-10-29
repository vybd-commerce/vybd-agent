import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { INTERVIEW_SCRIPT, JOBS_GUIDE } from "@/lib/agent/prompts";
import type { Ctx } from "@/lib/services/context";
import { runTool, TOOLS } from "@/lib/tools";

const MCP_PREAMBLE = `You are working with Vybd, a workspace where founders shape brand ideas into a living Brand Brief and buy real work on it (market research, supplier sourcing) from Vybd agents and operators. The brief is saved in the founder's Vybd account and shows up live in the Vybd web app.

Start by calling list_brands. If the founder is describing a new idea, call create_brand with a working name; if it matches an existing brand, use that one. Then run the interview below, writing to the brief with update_brand_brief as you learn things.

End every reply with one suggested next step the founder can say yes to. Once the brief is usable, offer: a market snapshot, a feedback page (create_share_page), or finding suppliers.`;

export function interviewPrompt(idea?: string) {
  return `${MCP_PREAMBLE}

${INTERVIEW_SCRIPT}

${JOBS_GUIDE}

Payments: approve_job returns a checkout link for paid jobs. Give the founder the link to open; never say a payment happened.${
    idea ? `\n\nThe founder's idea, in their words: ${idea}` : "\n\nAsk the founder what they're thinking of making."
  }`;
}

/** Build an MCP server bound to one signed-in user. Tools are the same table the web agent uses. */
export function createMcpServer(ctx: Ctx) {
  const server = new McpServer(
    { name: "vybd", version: "1.0.0" },
    { instructions: MCP_PREAMBLE },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (args: unknown) => {
        const res = await runTool(tool.name, args, { ctx, surface: "mcp" });
        return res.ok
          ? { content: [{ type: "text" as const, text: JSON.stringify(res.result, null, 2) }] }
          : { content: [{ type: "text" as const, text: res.error }], isError: true };
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

  return server;
}
