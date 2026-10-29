import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Ctx } from "@/lib/services/context";

/** Current user's service context, or redirect to /login. */
export async function requireCtx(next?: string): Promise<Ctx> {
  const session = await auth();
  if (!session?.user?.id) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return { userId: session.user.id, role: session.user.role };
}

/** For route handlers: returns null instead of redirecting. */
export async function getCtx(): Promise<Ctx | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { userId: session.user.id, role: session.user.role };
}
