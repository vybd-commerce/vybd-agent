import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { BriefFields } from "@/lib/brief";
import type { MessageAttachments } from "@/lib/types";

export const userRole = pgEnum("user_role", ["user", "operator"]);
export const brandStage = pgEnum("brand_stage", ["brief", "validate", "source", "store", "launch"]);
export const briefSource = pgEnum("brief_source", ["chat", "job", "user_edit", "mcp", "builder"]);
export const channel = pgEnum("channel", ["web", "mcp"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "operator", "system"]);
export const jobStatus = pgEnum("job_status", [
  "draft",
  "quoted",
  "approved",
  "in_progress",
  "delivered",
  "accepted",
  "cancelled",
  "failed",
]);
export const fulfiller = pgEnum("fulfiller", ["agent", "operator", "hybrid"]);
export const jobEventKind = pgEnum("job_event_kind", ["status", "progress", "message", "result"]);
export const actor = pgEnum("actor", ["user", "operator", "agent", "system"]);
export const wouldBuy = pgEnum("would_buy", ["yes", "maybe", "no"]);
export const memberRole = pgEnum("member_role", ["owner", "member"]);

// ---------- Auth.js tables (users doubles as the spec's users table) ----------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  role: userRole("role").notNull().default("user"),
  authProvider: text("auth_provider"),
  // Set when someone signs up from a brand's share page ("Start your own on Vybd").
  referredByBrandId: uuid("referred_by_brand_id"),
  // This person's user in the Brand Builder, which owns the canonical brief. Set on first use.
  builderUserId: text("builder_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------- Product tables ----------

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    stage: brandStage("stage").notNull().default("brief"),
    sharePublished: boolean("share_published").notNull().default(false),
    // Default public page shows one-liner, problem, positioning and price.
    shareHiddenFields: text("share_hidden_fields")
      .array()
      .notNull()
      .default(["customer", "alternative", "competitors", "channels", "nameDirections"]),
    // First time the Brand Score bar was met (score >= 80 and the validation gate). Set once.
    scoreUnlockedAt: timestamp("score_unlocked_at"),
    // The brand in the Brand Builder, owned there by the owner's builder user. Null until provisioned.
    builderBrandId: text("builder_brand_id").unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("brands_owner_idx").on(t.ownerId)],
);

// One row per person on a brand, the owner included. brands.owner_id stays the source of truth for ownership.
export const brandMembers = pgTable(
  "brand_members",
  {
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.userId] }), index("brand_members_user_idx").on(t.userId)],
);

// One reusable link per brand. Valid until expires_at or until the owner resets it (revoked_at).
export const invites = pgTable(
  "invites",
  {
    token: text("token").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("invites_brand_idx").on(t.brandId)],
);

export const inviteUses = pgTable(
  "invite_uses",
  {
    token: text("token")
      .notNull()
      .references(() => invites.token, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedAt: timestamp("used_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.token, t.userId] })],
);

// A brand's work split into areas a member can own. Every brand starts with DEFAULT_LANES (src/lib/services/lanes.ts).
export const lanes = pgTable(
  "lanes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    // Null while nobody has claimed the lane.
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lanes_brand_key_idx").on(t.brandId, t.key)],
);

export const laneTasks = pgTable(
  "lane_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => lanes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    doneBy: text("done_by").references(() => users.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("lane_tasks_lane_idx").on(t.laneId, t.position)],
);

export const briefVersions = pgTable(
  "brief_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fields: jsonb("fields").$type<BriefFields>().notNull(),
    pending: text("pending").array().notNull().default([]),
    source: briefSource("source").notNull(),
    // The person whose action produced this version (founder, member, or operator for job edits).
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    // Brand Builder brief version this row mirrors. Rows are a cache of the builder's brief once linked.
    builderVersion: integer("builder_version"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brief_versions_brand_version_idx").on(t.brandId, t.version)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    channel: channel("channel").notNull().default("web"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_brand_idx").on(t.brandId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    // Null for agent and system messages.
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    content: text("content").notNull().default(""),
    attachments: jsonb("attachments").$type<MessageAttachments>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("draft"),
    priceCents: integer("price_cents").notNull().default(0),
    etaDays: integer("eta_days").notNull().default(1),
    fulfiller: fulfiller("fulfiller").notNull(),
    operatorId: text("operator_id").references(() => users.id),
    result: jsonb("result").$type<Record<string, unknown>>(),
    stripeCheckoutSession: text("stripe_checkout_session"),
    stripePaymentIntent: text("stripe_payment_intent"),
    agentClaimedAt: timestamp("agent_claimed_at"),
    // The founder's own assistant (Claude, Codex over MCP) does the agent work, then submits the result.
    hostRun: boolean("host_run").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_brand_idx").on(t.brandId), index("jobs_status_idx").on(t.status)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    kind: jobEventKind("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actor: actor("actor").notNull(),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    wouldBuy: wouldBuy("would_buy").notNull(),
    priceAnswer: text("price_answer"),
    comment: text("comment"),
    email: text("email"),
    // Salted hash of the responder's IP; the Brand Score counts one answer per hash.
    ipHash: text("ip_hash"),
    // Answered by someone on the team while signed in. Shown, never scored.
    fromTeam: boolean("from_team").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("feedback_brand_idx").on(t.brandId)],
);

// ---------- MCP OAuth ----------

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name"),
  redirectUris: text("redirect_uris").array().notNull(),
  // Null for public clients (PKCE only). Confidential clients get a secret at registration.
  secretHash: text("secret_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const oauthCodes = pgTable("oauth_codes", {
  code: text("code").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope"),
  resource: text("resource"),
  expiresAt: timestamp("expires_at").notNull(),
});

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessTokenHash: text("access_token_hash").notNull().unique(),
  refreshTokenHash: text("refresh_token_hash").unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Private beta ----------

/** People who tried to sign in without beta access. Operators approve them in /ops/waitlist. */
export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
});

/** Fixed-window request counters (see src/lib/rate-limit.ts). Old windows are swept daily. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
