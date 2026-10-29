import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type Ctx = { userId: string; role: "user" | "operator" };

export class NotFoundError extends Error {
  status = 404;
}
export class ForbiddenError extends Error {
  status = 403;
}
export class InvalidStateError extends Error {
  status = 409;
}

export async function ctxForUser(userId: string): Promise<Ctx> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new NotFoundError("User not found");
  return { userId, role: user.role };
}
