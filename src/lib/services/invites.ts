import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { appUrl } from "@/lib/stripe";
import { type Ctx, InvalidStateError, NotFoundError } from "./context";
import { getMemberBrand, getOwnedBrand, isMember, listMembers } from "./brands";
import { latestBrief } from "./brief";
import { postToBrand } from "./conversations";
import { emitBrandEvent } from "./events";

// One reusable link per brand, so it survives being pasted into a group chat. Reset kills it.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteUrl(token: string) {
  return `${appUrl()}/join/${token}`;
}

async function liveInvite(brandId: string) {
  return db.query.invites.findFirst({
    where: and(
      eq(schema.invites.brandId, brandId),
      isNull(schema.invites.revokedAt),
      gt(schema.invites.expiresAt, new Date()),
    ),
    orderBy: desc(schema.invites.createdAt),
  });
}

async function newInvite(ctx: Ctx, brandId: string) {
  const [invite] = await db
    .insert(schema.invites)
    .values({ token: nanoid(16), brandId, createdBy: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning();
  return invite;
}

/** The brand's current invite link, creating one if none is live. Any member can share it. */
export async function getOrCreateInvite(ctx: Ctx, brandId: string) {
  await getMemberBrand(ctx, brandId);
  const invite = (await liveInvite(brandId)) ?? (await newInvite(ctx, brandId));
  return { token: invite.token, url: inviteUrl(invite.token), expiresAt: invite.expiresAt };
}

/** Kill the current link and issue a new one. Owner only. */
export async function resetInvite(ctx: Ctx, brandId: string) {
  await getOwnedBrand(ctx, brandId);
  await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.brandId, brandId), isNull(schema.invites.revokedAt)));
  const invite = await newInvite(ctx, brandId);
  return { token: invite.token, url: inviteUrl(invite.token), expiresAt: invite.expiresAt };
}

type InviteRow = typeof schema.invites.$inferSelect;

function inviteStatus(invite: InviteRow | undefined): "ok" | "expired" | "missing" {
  if (!invite) return "missing";
  if (invite.revokedAt || invite.expiresAt <= new Date()) return "expired";
  return "ok";
}

/** Public preview for the join page. Safe to show logged out: name, one-liner, inviter, team size. */
export async function previewInvite(token: string) {
  const invite = await db.query.invites.findFirst({ where: eq(schema.invites.token, token) });
  const status = inviteStatus(invite);
  if (status !== "ok") return { status } as const;
  const brand = await db.query.brands.findFirst({ where: eq(schema.brands.id, invite!.brandId) });
  if (!brand) return { status: "missing" } as const;
  const [inviter, brief, members] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, invite!.createdBy) }),
    latestBrief(brand.id),
    listMembers(brand.id),
  ]);
  return {
    status,
    brandId: brand.id,
    brandName: brand.name,
    oneLiner: typeof brief.fields.oneLiner === "string" ? brief.fields.oneLiner : null,
    inviterName: inviter?.name ?? inviter?.email?.split("@")[0] ?? "A friend",
    members: members.map((m) => ({ name: m.name ?? m.email?.split("@")[0] ?? "", image: m.image })),
  } as const;
}

/** Join the brand behind the link. Idempotent for people already on the team. */
export async function acceptInvite(ctx: Ctx, token: string) {
  const invite = await db.query.invites.findFirst({ where: eq(schema.invites.token, token) });
  const status = inviteStatus(invite);
  if (status === "missing") throw new NotFoundError("Invite not found");
  if (status === "expired") throw new InvalidStateError("This invite link has expired. Ask for a new one.");
  const { brandId } = invite!;
  if (await isMember(brandId, ctx.userId)) return { brandId, joined: false };

  await db.insert(schema.brandMembers).values({ brandId, userId: ctx.userId, role: "member" }).onConflictDoNothing();
  await db.insert(schema.inviteUses).values({ token, userId: ctx.userId }).onConflictDoNothing();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, ctx.userId) });
  const name = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
  await postToBrand(brandId, { role: "system", content: `${name} joined the brand.` });
  await emitBrandEvent(brandId, { type: "brand" });
  return { brandId, joined: true };
}
