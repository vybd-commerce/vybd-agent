import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import type { Provider } from "next-auth/providers";
import { db, schema } from "@/db";
import { INVITE_COOKIE, canSignIn, joinWaitlist } from "@/lib/services/beta";
import { clientIp, rateLimit } from "@/lib/rate-limit";

function operatorEmails() {
  return (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Development magic link: printed to the server log instead of emailed.
const consoleMagicLink: Provider = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: 60 * 60,
  async sendVerificationRequest({ identifier, url }) {
    console.log(`\n[auth] Magic link for ${identifier}:\n${url}\n`);
  },
};

/** Share-page slug that sent a new visitor to sign up ("Start your own on Vybd"). */
export const REFERRAL_COOKIE = "vybd_ref";

const providers: Provider[] = [];
// Real email needs a verified sending domain in Resend. Without one, production is Google-only.
if (process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL_FROM) {
  providers.push(Resend({ id: "email", from: process.env.AUTH_EMAIL_FROM, maxAge: 60 * 60 }));
} else if (process.env.NODE_ENV !== "production") {
  providers.push(consoleMagicLink);
}
export const emailEnabled = providers.length > 0;
export const emailIsConsole = providers[0] === consoleMagicLink;

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push(Google);
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) providers.push(GitHub);
export const githubEnabled = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers,
  session: { strategy: "database" },
  pages: { signIn: "/login", verifyRequest: "/login?sent=1", error: "/login" },
  callbacks: {
    // Private beta gate. Runs on the Google callback and when a magic link is requested.
    async signIn({ user }) {
      if (!user.email) return false;
      const jar = await cookies().catch(() => null);
      if (await canSignIn(user.email, jar?.get(INVITE_COOKIE)?.value)) return true;
      const ip = clientIp(await headers().catch(() => new Headers()));
      if ((await rateLimit(`waitlist:${ip}`, 10, 3600)).ok) await joinWaitlist(user.email, user.name);
      return "/login?waitlist=1";
    },
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as { role?: "user" | "operator" }).role ?? "user";
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      const jar = await cookies().catch(() => null);
      const slug = jar?.get(REFERRAL_COOKIE)?.value;
      if (!slug) return;
      const brand = await db.query.brands.findFirst({ where: eq(schema.brands.slug, slug) });
      if (brand) await db.update(schema.users).set({ referredByBrandId: brand.id }).where(eq(schema.users.id, user.id));
      jar?.delete(REFERRAL_COOKIE);
    },
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
