// Usage: pnpm make-operator you@example.com
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error("Usage: pnpm make-operator <email>");
    process.exit(1);
  }
  const [user] = await db.update(schema.users).set({ role: "operator" }).where(eq(schema.users.email, email)).returning();
  console.log(user ? `${email} is now an operator.` : `No user with email ${email}. Sign in once first, or add it to OPERATOR_EMAILS.`);
  await sql.end();
}

void main();
