import { getBrandState } from "@/lib/services/brand-state";
import { errorResponse } from "@/lib/http";
import { getCtx } from "@/lib/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/brands/[id]/state">) {
  const userCtx = await getCtx();
  if (!userCtx) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return Response.json(await getBrandState(userCtx, id));
  } catch (err) {
    return errorResponse(err);
  }
}
