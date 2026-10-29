import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MessageAttachments } from "@/lib/types";
import { type Ctx, NotFoundError } from "./context";
import { getBrand, getOwnedBrand } from "./brands";
import { emitBrandEvent } from "./events";

export type Message = typeof schema.messages.$inferSelect;

export async function listConversations(ctx: Ctx, brandId: string) {
  await getBrand(ctx, brandId);
  return db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.brandId, brandId))
    .orderBy(desc(schema.conversations.createdAt));
}

/** Latest conversation on the given channel, creating one if none exists. */
export async function ensureConversation(ctx: Ctx, brandId: string, channel: "web" | "mcp" = "web") {
  await getOwnedBrand(ctx, brandId);
  return latestConversation(brandId, channel, true);
}

export async function latestConversation(brandId: string, channel: "web" | "mcp" = "web", create = false) {
  const existing = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.brandId, brandId), eq(schema.conversations.channel, channel)),
    orderBy: desc(schema.conversations.createdAt),
  });
  if (existing || !create) return existing ?? null;
  const [conv] = await db.insert(schema.conversations).values({ brandId, channel }).returning();
  return conv;
}

export async function getConversation(ctx: Ctx, conversationId: string) {
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!conv) throw new NotFoundError("Conversation not found");
  await getBrand(ctx, conv.brandId);
  return conv;
}

export async function listMessages(ctx: Ctx, conversationId: string) {
  await getConversation(ctx, conversationId);
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt));
}

export async function appendMessage(
  conversationId: string,
  input: { role: Message["role"]; content: string; attachments?: MessageAttachments },
) {
  const [msg] = await db
    .insert(schema.messages)
    .values({ conversationId, role: input.role, content: input.content, attachments: input.attachments ?? {} })
    .returning();
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (conv) await emitBrandEvent(conv.brandId, { type: "message", conversationId });
  return msg;
}

export async function updateMessageAttachments(messageId: string, attachments: MessageAttachments) {
  const [msg] = await db
    .update(schema.messages)
    .set({ attachments })
    .where(eq(schema.messages.id, messageId))
    .returning();
  return msg;
}

/** Post an agent/system message to the brand's latest web conversation (used by jobs). */
export async function postToBrand(
  brandId: string,
  input: { role?: Message["role"]; content: string; attachments?: MessageAttachments },
) {
  const conv = await latestConversation(brandId, "web", true);
  return appendMessage(conv!.id, { role: input.role ?? "assistant", content: input.content, attachments: input.attachments });
}
