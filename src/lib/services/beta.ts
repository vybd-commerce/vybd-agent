import { desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./context";
import { ForbiddenError } from "./context";

/** Cookie holding the invite token of a /join link the visitor is signing in through. */
export const INVITE_COOKIE = "vybd_invite";

function list(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** BETA_GATE=off opens sign-up to everyone. Any other value (or unset) keeps the private beta. */
export function betaGateEnabled() {
  return process.env.BETA_GATE !== "off";
}

/** BETA_ALLOWLIST takes emails and whole domains: "ana@x.com,@vybd.co". */
function onAllowlist(email: string) {
  const domain = email.slice(email.lastIndexOf("@"));
  return [...list("BETA_ALLOWLIST"), ...list("OPERATOR_EMAILS")].some((e) => e === email || e === domain);
}

async function hasLiveInvite(token: string | undefined) {
  if (!token) return false;
  const invite = await db.query.invites.findFirst({ where: eq(schema.invites.token, token) });
  return Boolean(invite && !invite.revokedAt && invite.expiresAt > new Date());
}

/**
 * Who may sign in during the private beta: allowlisted emails, existing accounts,
 * people an operator approved from the waitlist, and anyone holding a live brand invite.
 */
export async function canSignIn(rawEmail: string, inviteToken?: string) {
  if (!betaGateEnabled()) return true;
  const email = rawEmail.trim().toLowerCase();
  if (onAllowlist(email)) return true;
  const [user, entry] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.email, email) }),
    db.query.waitlist.findFirst({ where: eq(schema.waitlist.email, email) }),
  ]);
  if (user || entry?.approvedAt) return true;
  return hasLiveInvite(inviteToken);
}

export async function joinWaitlist(rawEmail: string, name?: string | null) {
  await db
    .insert(schema.waitlist)
    .values({ email: rawEmail.trim().toLowerCase(), name: name ?? null })
    .onConflictDoNothing();
}

function requireOperator(ctx: Ctx) {
  if (ctx.role !== "operator") throw new ForbiddenError("Operators only");
}

export async function listWaitlist(ctx: Ctx, { pending }: { pending: boolean }) {
  requireOperator(ctx);
  return db.query.waitlist.findMany({
    where: pending ? isNull(schema.waitlist.approvedAt) : undefined,
    orderBy: desc(schema.waitlist.createdAt),
    limit: 200,
  });
}

export async function approveWaitlist(ctx: Ctx, email: string) {
  requireOperator(ctx);
  await db
    .update(schema.waitlist)
    .set({ approvedAt: new Date(), approvedBy: ctx.userId })
    .where(eq(schema.waitlist.email, email.trim().toLowerCase()));
}
