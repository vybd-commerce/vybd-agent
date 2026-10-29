import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { db, schema } from "@/db";

function operatorEmails() {
  return (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Magic link with no email provider yet: the link is printed to the server log.
const consoleMagicLink: Provider = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: 60 * 60,
  async sendVerificationRequest({ identifier, url }) {
    console.log(`\n[auth] Magic link for ${identifier}:\n${url}\n`);
  },
};

const providers: Provider[] = [consoleMagicLink];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);

export const googleEnabled = providers.some((p) => typeof p === "function" || (p as { id?: string }).id === "google");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers,
  session: { strategy: "database" },
  pages: { signIn: "/login", verifyRequest: "/login?sent=1" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as { role?: "user" | "operator" }).role ?? "user";
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      const set: Partial<typeof schema.users.$inferInsert> = {};
      if (user.email && operatorEmails().includes(user.email.toLowerCase())) set.role = "operator";
      const existing = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
      if (existing && !existing.authProvider && account?.provider) set.authProvider = account.provider;
      if (Object.keys(set).length) await db.update(schema.users).set(set).where(eq(schema.users.id, user.id));
    },
  },
});
