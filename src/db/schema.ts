import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  numeric,
  date,
  uuid,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

/** Raw binary column (Postgres bytea) — used to store uploaded media bytes. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/* ============================================================
 * Subscription plans (3 tiers + Enterprise/custom).
 * ========================================================== */
export const planEnum = pgEnum("plan", [
  "starter",
  "growth",
  "pro",
  "enterprise",
]);

// Per-church SMS sender ID approval state.
export const smsSenderStatusEnum = pgEnum("sms_sender_status", [
  "none",
  "pending",
  "approved",
  "rejected",
  "revoked",
]);
// SMS wallet ledger entry direction.
export const smsTxnKindEnum = pgEnum("sms_txn_kind", ["credit", "debit"]);
// Unified wallet ledger entry direction.
export const walletTxnKindEnum = pgEnum("wallet_txn_kind", ["credit", "debit"]);
// What a wallet movement was for.
export const walletTxnCategoryEnum = pgEnum("wallet_txn_category", [
  "topup", // money in (Paystack)
  "sms", // SMS send
  "storage", // storage add-on subscription
  "adjustment", // admin credit/debit
  "refund",
]);
// Billing payment lifecycle.
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "success",
  "failed",
]);

// Communication module channels.
export const communicationChannelEnum = pgEnum("communication_channel", [
  "sms",
  "email",
  "notification",
]);

/* ============================================================
 * Better Auth — core tables
 * Property names are camelCase to match Better Auth field names;
 * columns are snake_case via drizzle `casing: "snake_case"`.
 * ========================================================== */

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  // Platform-level superadmin (FlockInsight operator), distinct from
  // per-church roles. Bootstrap manually in the DB for your account.
  isSuperAdmin: boolean().notNull().default(false),
  // Set when support resets a password — forces a new password on next login.
  mustChangePassword: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  expiresAt: timestamp().notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // organization plugin: the church the user is currently acting within
  activeOrganizationId: text(),
});

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp(),
  refreshTokenExpiresAt: timestamp(),
  scope: text(),
  password: text(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

/* ============================================================
 * Better Auth — organization plugin
 * organization -> `church` (the tenant)
 * member       -> `staff`  (login users + their role per church)
 * ========================================================== */

// Platform status for a church (set by superadmin).
export const churchStatusEnum = pgEnum("church_status", [
  "active",
  "suspended",
]);

export const church = pgTable("church", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  createdAt: timestamp().notNull().defaultNow(),
  metadata: text(),
  // ----- FlockInsight additional fields -----
  timezone: text().notNull().default("Africa/Lagos"),
  currency: text().notNull().default("NGN"),
  country: text().notNull().default("Nigeria"),
  state: text(),
  plan: planEnum().notNull().default("starter"),
  status: churchStatusEnum().notNull().default("active"),
  // ----- Billing -----
  planRenewsAt: timestamp({ withTimezone: true }),
  planDiscountPct: integer().notNull().default(0), // admin-granted discount 0..100
  // ----- Free trial ("first 7 Sundays free") -----
  // End of the free trial. Null = grandfathered (never gated). Set at signup.
  trialEndsAt: timestamp({ withTimezone: true }),
  // Superadmin comp: when true, the church never needs to pay to keep using the app.
  paymentWaived: boolean().notNull().default(false),
  // Which trial-ending reminders have been sent (0=none,1=14d,2=7d,3=3d) — idempotent cron.
  trialReminderStage: integer().notNull().default(0),
  // ----- SMS -----
  smsSenderId: text(), // requested/approved sender ID (<=11 chars)
  smsSenderStatus: smsSenderStatusEnum().notNull().default("none"),
  smsSenderNote: text(), // application note / rejection reason
  // Legacy SMS-only balance. Superseded by the unified `walletBalance` below
  // (migration 0028 copies this value across). Kept for history; not written to.
  smsBalance: numeric({ precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  // ----- Unified wallet (funds SMS sends, storage add-ons & future features) -----
  walletBalance: numeric({ precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  // ----- Storage -----
  // Purchased extra storage beyond the free base (BASE_STORAGE_BYTES). The
  // effective limit = base + storageExtraBytes.
  storageExtraBytes: bigint({ mode: "number" }).notNull().default(0),
  // Active monthly storage add-on: cost (deducted from the wallet each renewal)
  // and when it next renews. Zero cost / null date = on the free base only.
  storageMonthlyCost: numeric({ precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  storageRenewsAt: timestamp({ withTimezone: true }),
  // ----- Public profile / directory -----
  // Public URL username (e.g. /c/grace-chapel). Defaults to `slug` on create,
  // editable by the church. Unique so links are stable & unambiguous.
  handle: text().unique(),
  // Whether the church is listed in the public directory & its page is live.
  publicEnabled: boolean().notNull().default(true),
  denomination: text(),
  tagline: text(),
  about: text(),
  coverUrl: text(),
  // Public page colour theme (see lib/church-themes.ts). Default "indigo".
  theme: text().notNull().default("indigo"),
  // Gallery: [{ url, caption? }].
  photos: jsonb()
    .$type<{ url: string; caption?: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  addressText: text(),
  landmarks: text(),
  city: text(),
  // Coordinates for "nearest to me" sorting in the directory (optional).
  lat: numeric({ precision: 9, scale: 6, mode: "number" }),
  lng: numeric({ precision: 9, scale: 6, mode: "number" }),
  publicPhone: text(),
  publicEmail: text(),
  website: text(),
  // { facebook, instagram, youtube, tiktok, x, whatsapp }.
  socials: jsonb()
    .$type<Record<string, string>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  // Highlighted in the public directory by the platform.
  featured: boolean().notNull().default(false),
});

/* ============================================================
 * FlockInsight domain — promo banners / ad slots (platform-managed)
 * ========================================================== */
export const banner = pgTable("banner", {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  imageUrl: text(),
  linkUrl: text(),
  // Where it shows: 'directory' | 'events' | 'both'.
  placement: text().notNull().default("both"),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* ============================================================
 * FlockInsight domain — uploaded media (logos, covers, photos, sermons, files)
 *
 * Two storage backends, recorded by `provider`:
 *  - "db":         legacy rows whose bytes live in Postgres (`data`), served by
 *                  /media/[id]. Kept working for back-compat.
 *  - "cloudinary": new rows uploaded to Cloudinary (optimised/resized to keep
 *                  them light). `publicId`/`url`/`resourceType` describe the
 *                  remote asset; `data` is null. /media/[id] redirects to it.
 *
 * Every row records `bytes` so a church's storage usage (and 200MB quota) can
 * be summed cheaply. `kind` doubles as the category:
 *   logo | cover | photo | member | event | sermon | file
 * ========================================================== */
export const media = pgTable(
  "media",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    kind: text().notNull().default("photo"),
    mime: text().notNull(),
    // Authoritative stored size, in bytes (after optimisation). `size` is kept
    // for legacy db-backed rows; new code reads/sums `bytes`.
    size: integer().notNull().default(0),
    bytes: bigint({ mode: "number" }).notNull().default(0),
    data: bytea(), // null for Cloudinary-backed rows
    // ----- Cloudinary backend -----
    provider: text().notNull().default("db"), // db | cloudinary
    publicId: text(), // Cloudinary public_id (for delete/transform)
    resourceType: text(), // image | video | raw
    url: text(), // Cloudinary secure_url
    format: text(), // jpg | webp | mp4 | mp3 | pdf | ...
    width: integer(),
    height: integer(),
    durationSec: numeric({ precision: 10, scale: 2, mode: "number" }), // audio/video
    // ----- Display / library -----
    title: text(), // human label (e.g. sermon title); falls back to originalName
    originalName: text(),
    uploadedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_church_idx").on(t.churchId),
    index("media_church_kind_idx").on(t.churchId, t.kind),
  ],
);

export const staff = pgTable("staff", {
  id: text().primaryKey(),
  organizationId: text()
    .notNull()
    .references(() => church.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // Better Auth org role ("owner"/"admin"/"member"). Owner = church creator,
  // always full access. `roleId` (below) is the church-defined feature role.
  role: text().notNull().default("member"),
  roleId: uuid().references(() => role.id, { onDelete: "set null" }),
  // Temporary membership created while a superadmin "acts as" this church, so
  // org-plugin operations (invites etc.) work. Cleaned up on exit; hidden from
  // the church's own team list.
  temp: boolean().notNull().default(false),
  createdAt: timestamp().notNull().defaultNow(),
});

/* ============================================================
 * FlockInsight domain — roles & permissions (church-defined RBAC)
 * Each church creates roles and grants them permission keys
 * (see src/lib/permissions.ts for the catalog). Owner is locked.
 * ========================================================== */

export const role = pgTable(
  "role",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    // Array of permission keys, e.g. {"giving.view","giving.manage"}.
    permissions: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Locked, full-access role (the church creator). Can't be edited/deleted.
    isSystem: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("role_church_idx").on(t.churchId),
    uniqueIndex("role_church_name_idx").on(t.churchId, t.name),
  ],
);

export const invitation = pgTable("invitation", {
  id: text().primaryKey(),
  organizationId: text()
    .notNull()
    .references(() => church.id, { onDelete: "cascade" }),
  email: text().notNull(),
  role: text(),
  status: text().notNull().default("pending"),
  expiresAt: timestamp().notNull(),
  // Better Auth (org plugin) requires this on the invitation model.
  createdAt: timestamp().notNull().defaultNow(),
  inviterId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * FlockInsight domain — enums
 * ========================================================== */

export const genderEnum = pgEnum("gender", ["male", "female"]);
export const memberStatusEnum = pgEnum("member_status", [
  "active",
  "inactive",
  "visitor",
  "new_convert",
]);
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
]);

// Follow-up module (visitor tracking + interactions).
export const followUpStatusEnum = pgEnum("follow_up_status", [
  "new",
  "contacted",
  "in_progress",
  "joined",
  "not_interested",
]);
export const interactionTypeEnum = pgEnum("interaction_type", [
  "visit",
  "call",
  "sms",
  "whatsapp",
  "email",
  "note",
]);
export const interactionOutcomeEnum = pgEnum("interaction_outcome", [
  "reached",
  "no_response",
  "scheduled",
  "not_interested",
]);

// Ministries & groups module. A single model with a `type` so a church can
// organise people as ministries, departments, home cells, committees, etc.
export const groupTypeEnum = pgEnum("group_type", [
  "ministry",
  "department",
  "group",
  "cell",
  "committee",
  "class",
]);

// How a gift was given. Optional on each giving record.
export const givingMethodEnum = pgEnum("giving_method", [
  "cash",
  "transfer",
  "card",
  "cheque",
  "online",
  "other",
]);

/* ============================================================
 * FlockInsight domain — congregation
 * `member` = a person in the congregation (not necessarily a login).
 * Every record is scoped to a church (tenant).
 * ========================================================== */

export const member = pgTable(
  "member",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    firstName: text().notNull(),
    middleName: text(),
    lastName: text(),
    gender: genderEnum(),
    phone: text(),
    email: text(),
    // Link to a login account, when this person is also a staff/team member.
    // One person = one member profile (avoids duplicates). Null for most members.
    userId: text().references(() => user.id, { onDelete: "set null" }),
    dateOfBirth: date(),
    status: memberStatusEnum().notNull().default("active"),
    joinedAt: date(),
    photoUrl: text(),
    // ----- Milestones / anniversaries -----
    weddingDate: date(),
    baptized: boolean().notNull().default(false),
    baptismDate: date(),
    // Free-form extra anniversaries: [{ label, date: "YYYY-MM-DD" }].
    anniversaries: jsonb()
      .$type<{ label: string; date: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Legacy free-form address (kept for back-compat); structured parts below.
    address: text(),
    house: text(),
    street: text(),
    city: text(),
    lga: text(),
    state: text(),
    country: text(),
    notes: text(),
    // ----- Follow-up module -----
    // Visitors/new converts are followed up automatically (by status);
    // `inFollowUp` lets the team add any other member manually.
    inFollowUp: boolean().notNull().default(false),
    followUpStatus: followUpStatusEnum(),
    assignedToId: text().references(() => user.id, { onDelete: "set null" }),
    lastContactedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("member_church_idx").on(t.churchId),
    // A login links to at most one member per church.
    uniqueIndex("member_church_user_idx").on(t.churchId, t.userId),
  ],
);

/* ============================================================
 * FlockInsight domain — services (recurring gathering types)
 * ========================================================== */

export const service = pgTable(
  "service",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: text().notNull(),
    dayOfWeek: integer(), // 0=Sun .. 6=Sat; null = ad-hoc
    startTime: text(), // "09:00"
    description: text(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("service_church_idx").on(t.churchId)],
);

/* ============================================================
 * FlockInsight domain — attendance
 * A session = one instance of taking attendance (fast headcounts),
 * with optional per-member check-in records.
 * ========================================================== */

export const attendanceSession = pgTable(
  "attendance_session",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    serviceId: uuid().references(() => service.id, { onDelete: "set null" }),
    title: text(), // label for one-off events (when serviceId is null)
    date: date().notNull(),
    // ----- fast headcounts -----
    totalCount: integer().notNull().default(0),
    maleCount: integer().notNull().default(0),
    femaleCount: integer().notNull().default(0),
    childrenCount: integer().notNull().default(0),
    firstTimerCount: integer().notNull().default(0),
    newConvertCount: integer().notNull().default(0),
    notes: text(),
    recordedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("att_session_church_idx").on(t.churchId),
    index("att_session_date_idx").on(t.date),
    // one session per service per day per church (nulls allowed -> many ad-hoc)
    uniqueIndex("att_session_unique").on(t.churchId, t.serviceId, t.date),
  ],
);

export const attendanceRecord = pgTable(
  "attendance_record",
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => attendanceSession.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum().notNull().default("present"),
    checkedInAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("att_record_unique").on(t.sessionId, t.memberId)],
);

/* ============================================================
 * FlockInsight domain — follow-up interactions
 * A log of contact the follow-up team makes with a member
 * (visits, calls, SMS, etc.).
 * ========================================================== */

export const followUpInteraction = pgTable(
  "follow_up_interaction",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    type: interactionTypeEnum().notNull(),
    outcome: interactionOutcomeEnum(),
    notes: text(),
    occurredAt: date().notNull(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("follow_up_member_idx").on(t.memberId),
    index("follow_up_church_idx").on(t.churchId),
  ],
);

/* ============================================================
 * FlockInsight domain — ministries & groups
 * A group is any organised body within a church (ministry, department,
 * home cell, committee...). Members join via `group_membership`.
 * ========================================================== */

export const group = pgTable(
  "church_group",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: groupTypeEnum().notNull().default("ministry"),
    description: text(),
    meetingDay: integer(), // 0=Sun .. 6=Sat; null = no fixed day
    meetingTime: text(), // "18:00"
    isActive: boolean().notNull().default(true),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("group_church_idx").on(t.churchId)],
);

export const groupMembership = pgTable(
  "group_membership",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    // A leader/head of this group. A group can have many.
    isLeader: boolean().notNull().default(false),
    // Free-form title within the group (e.g. "Ministry Head", "Treasurer").
    role: text(),
    joinedAt: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("group_membership_unique").on(t.groupId, t.memberId),
    index("group_membership_member_idx").on(t.memberId),
  ],
);

/* ============================================================
 * FlockInsight domain — giving (offerings, tithe, donations, projects...)
 * Categories are church-defined (like services); each `giving` row is one
 * recorded gift, optionally tied to a member.
 * ========================================================== */

export const givingCategory = pgTable(
  "giving_category",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("giving_category_church_idx").on(t.churchId)],
);

export const giving = pgTable(
  "giving",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    // Keep the record if its category is deleted (set null, show "Uncategorised").
    categoryId: uuid().references(() => givingCategory.id, {
      onDelete: "set null",
    }),
    // Optional registered giver. Set null on member delete; giverName preserves
    // a label for non-members or after a member is removed.
    memberId: uuid().references(() => member.id, { onDelete: "set null" }),
    giverName: text(),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    method: givingMethodEnum(),
    date: date().notNull(),
    note: text(),
    recordedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("giving_church_idx").on(t.churchId),
    index("giving_date_idx").on(t.date),
    index("giving_category_idx").on(t.categoryId),
  ],
);

/* ============================================================
 * FlockInsight platform — notifications & web push
 * Platform admins broadcast notifications to all churches, a plan tier,
 * a country, or a hand-picked set of churches. Read state is per-user.
 * ========================================================== */

export const notificationCategoryEnum = pgEnum("notification_category", [
  "system",
  "general",
]);
export const notificationAudienceEnum = pgEnum("notification_audience", [
  "all",
  "plan",
  "country",
  "churches",
  "user", // a single staff member (e.g. follow-up assignment)
]);

export const notification = pgTable(
  "notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    body: text().notNull(),
    category: notificationCategoryEnum().notNull().default("general"),
    audience: notificationAudienceEnum().notNull().default("all"),
    targetPlan: planEnum(), // when audience = "plan"
    targetCountry: text(), // when audience = "country"
    targetUserId: text().references(() => user.id, { onDelete: "cascade" }), // when audience = "user"
    linkUrl: text(), // optional call-to-action link
    pushSent: integer().notNull().default(0), // count of web-push messages sent
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_created_idx").on(t.createdAt)],
);

// Hand-picked recipient churches (when audience = "churches").
export const notificationTarget = pgTable(
  "notification_target",
  {
    notificationId: uuid()
      .notNull()
      .references(() => notification.id, { onDelete: "cascade" }),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.churchId] })],
);

// Per-user read state for the in-app notification centre.
export const notificationRead = pgTable(
  "notification_read",
  {
    id: uuid().primaryKey().defaultRandom(),
    notificationId: uuid()
      .notNull()
      .references(() => notification.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_read_unique").on(t.notificationId, t.userId),
  ],
);

/* ============================================================
 * Platform admin — audit log + scheduled broadcasts
 * ========================================================== */

// Record of superadmin actions, for accountability.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: text().references(() => user.id, { onDelete: "set null" }),
    actorName: text(),
    action: text().notNull(), // e.g. "impersonate", "reset_password", "set_plan"
    summary: text().notNull(),
    targetType: text(), // "church" | "user" | "broadcast" | ...
    targetId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const broadcastStatusEnum = pgEnum("broadcast_status", [
  "scheduled",
  "sent",
  "cancelled",
]);

// Scheduled broadcast (in-app and/or email) to an audience, sent by a cron.
export const broadcast = pgTable(
  "broadcast",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    body: text().notNull(),
    category: notificationCategoryEnum().notNull().default("general"),
    audience: notificationAudienceEnum().notNull().default("all"),
    targetPlan: planEnum(),
    targetCountry: text(),
    churchIds: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    linkUrl: text(),
    inApp: boolean().notNull().default(true), // in-app notification + web push
    email: boolean().notNull().default(false),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    status: broadcastStatusEnum().notNull().default("scheduled"),
    sentAt: timestamp({ withTimezone: true }),
    pushSent: integer().notNull().default(0),
    emailSent: integer().notNull().default(0),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("broadcast_status_idx").on(t.status, t.scheduledAt)],
);

// Browser web-push subscriptions (one per device/browser per user).
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_sub_endpoint_idx").on(t.endpoint),
    index("push_sub_user_idx").on(t.userId),
  ],
);

/* ============================================================
 * Platform settings (key/value, admin-configurable) + SMS wallet + billing
 * ========================================================== */

export const platformSetting = pgTable("platform_setting", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const smsWalletTxn = pgTable(
  "sms_wallet_txn",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    kind: smsTxnKindEnum().notNull(),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    balanceAfter: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    reason: text(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sms_txn_church_idx").on(t.churchId)],
);

/* ----- Unified wallet ledger + top-ups (supersede the SMS-specific ones) ----- */

export const walletTxn = pgTable(
  "wallet_txn",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    kind: walletTxnKindEnum().notNull(),
    category: walletTxnCategoryEnum().notNull().default("adjustment"),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    balanceAfter: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    reason: text(),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wallet_txn_church_idx").on(t.churchId)],
);

// Church-initiated wallet top-ups (paid via Paystack).
export const walletTopup = pgTable(
  "wallet_topup",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    reference: text().notNull().unique(),
    status: paymentStatusEnum().notNull().default("pending"),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("wallet_topup_church_idx").on(t.churchId)],
);

// Church-initiated SMS wallet top-ups (paid via Paystack).
export const smsTopup = pgTable(
  "sms_topup",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    reference: text().notNull().unique(),
    status: paymentStatusEnum().notNull().default("pending"),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("sms_topup_church_idx").on(t.churchId)],
);

export const payment = pgTable(
  "payment",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    plan: planEnum().notNull(),
    amount: numeric({ precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text().notNull().default("NGN"),
    gateway: text().notNull().default("paystack"),
    reference: text().notNull().unique(),
    status: paymentStatusEnum().notNull().default("pending"),
    periodMonths: integer().notNull().default(1),
    note: text(), // e.g. "Admin onboarding" / discount applied
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("payment_church_idx").on(t.churchId)],
);

/* ============================================================
 * Communication module — bulk/group/single SMS, email, staff notices
 * ========================================================== */

export const communicationLog = pgTable(
  "communication_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    channel: communicationChannelEnum().notNull(),
    audience: text().notNull(), // human label, e.g. "All members", "Group: Choir"
    subject: text(), // email only
    body: text().notNull(),
    recipients: integer().notNull().default(0),
    sent: integer().notNull().default(0),
    failed: integer().notNull().default(0),
    cost: numeric({ precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comm_log_church_idx").on(t.churchId)],
);

/* ============================================================
 * Personal to-do (per user, syncs across devices)
 * ========================================================== */

export const todo = pgTable(
  "todo",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    text: text().notNull(),
    done: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("todo_user_idx").on(t.userId)],
);

/* ============================================================
 * FlockInsight domain — automatic service reminders to members
 * One settings row per church + a run log to make the cron idempotent.
 * ========================================================== */

export const reminderSetting = pgTable("reminder_setting", {
  churchId: text()
    .primaryKey()
    .references(() => church.id, { onDelete: "cascade" }),
  enabled: boolean().notNull().default(false),
  sms: boolean().notNull().default(false),
  email: boolean().notNull().default(true),
  // Send the day before the service (vs the same day).
  dayBefore: boolean().notNull().default(false),
  // Local church time to send, "HH:MM" (24h).
  sendTime: text().notNull().default("07:00"),
  // active | all (which members to remind).
  audience: text().notNull().default("active"),
  smsTemplate: text()
    .notNull()
    .default(
      "Hi {name}, reminder: {service} holds {day} {time} at {church}. We can't wait to see you!",
    ),
  emailSubject: text()
    .notNull()
    .default("See you at {church} for {service}"),
  emailTemplate: text()
    .notNull()
    .default(
      "Hi {name},\n\nThis is a friendly reminder that {service} holds {day} at {time}.\n\nWe look forward to worshipping with you at {church}!",
    ),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const reminderRun = pgTable(
  "reminder_run",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    serviceId: uuid().references(() => service.id, { onDelete: "cascade" }),
    serviceDate: date().notNull(),
    sentSms: integer().notNull().default(0),
    sentEmail: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // One reminder per service occurrence — makes a re-run a no-op.
  (t) => [uniqueIndex("reminder_run_unique").on(t.serviceId, t.serviceDate)],
);

/* ============================================================
 * FlockInsight domain — support tickets (church ↔ platform)
 * ========================================================== */

export const supportTicketStatusEnum = pgEnum("support_ticket_status", [
  "open", // awaiting a reply from support
  "answered", // support replied, awaiting the church
  "closed",
]);
export const supportAuthorEnum = pgEnum("support_author", ["church", "support"]);

export const supportTicket = pgTable(
  "support_ticket",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    subject: text().notNull(),
    category: text().notNull().default("general"),
    status: supportTicketStatusEnum().notNull().default("open"),
    contactName: text(),
    contactEmail: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastReplyAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_ticket_church_idx").on(t.churchId),
    index("support_ticket_status_idx").on(t.status),
  ],
);

export const supportMessage = pgTable(
  "support_message",
  {
    id: uuid().primaryKey().defaultRandom(),
    ticketId: uuid()
      .notNull()
      .references(() => supportTicket.id, { onDelete: "cascade" }),
    authorType: supportAuthorEnum().notNull(),
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    authorName: text(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_message_ticket_idx").on(t.ticketId)],
);

/* ============================================================
 * FlockInsight domain — usage stats (emails/SMS sent, per church per day)
 * Daily rollups so platform analytics stay cheap to query.
 * ========================================================== */
export const usageStat = pgTable(
  "usage_stat",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    metric: text().notNull(), // 'email' | 'sms'
    day: date().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_stat_unique").on(t.churchId, t.metric, t.day),
    index("usage_stat_metric_idx").on(t.metric),
  ],
);

/* ============================================================
 * FlockInsight domain — birthday & anniversary auto-messages
 * ========================================================== */
export const celebrationSetting = pgTable("celebration_setting", {
  churchId: text()
    .primaryKey()
    .references(() => church.id, { onDelete: "cascade" }),
  enabled: boolean().notNull().default(false),
  sms: boolean().notNull().default(false),
  email: boolean().notNull().default(true),
  sendTime: text().notNull().default("08:00"), // local church time HH:MM
  birthdaySms: text()
    .notNull()
    .default(
      "Happy birthday, {name}! 🎉 Everyone at {church} celebrates you today. Have a blessed year!",
    ),
  birthdayEmailSubject: text().notNull().default("Happy Birthday, {name}! 🎉"),
  birthdayEmailBody: text()
    .notNull()
    .default(
      "Dear {name},\n\nHappy birthday! On behalf of the entire {church} family, we celebrate the gift of your life today. May this new year be filled with God's blessings, joy and good health.\n\nWe love and appreciate you!",
    ),
  anniversarySms: text()
    .notNull()
    .default(
      "Happy {occasion}, {name}! 🎊 {church} celebrates with you today. God bless you!",
    ),
  anniversaryEmailSubject: text().notNull().default("Happy {occasion}, {name}!"),
  anniversaryEmailBody: text()
    .notNull()
    .default(
      "Dear {name},\n\nCongratulations on your {occasion}! The {church} family rejoices with you and prays God's continued blessing over you.\n\nWith love,\n{church}",
    ),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const celebrationRun = pgTable(
  "celebration_run",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    memberId: uuid().references(() => member.id, { onDelete: "cascade" }),
    kind: text().notNull(), // 'birthday' | 'wedding' | 'baptism' | custom label
    onDate: date().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("celebration_run_unique").on(t.memberId, t.kind, t.onDate)],
);

/* ============================================================
 * FlockInsight domain — events (with optional public listing)
 * ========================================================== */
export const event = pgTable(
  "event",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    flyerUrl: text(),
    date: date().notNull(),
    startTime: text(), // "HH:MM"
    endTime: text(),
    venue: text(),
    address: text(),
    // Show in the public events directory & on the church's public page.
    isPublic: boolean().notNull().default(true),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_church_idx").on(t.churchId),
    index("event_date_idx").on(t.date),
  ],
);

/* ============================================================
 * FlockInsight domain — form builder (Google-Forms-style)
 * Churches design forms (fields stored as jsonb), publish a public link
 * (/f/<slug>), and collect responses. Responses can match/create members.
 * ========================================================== */
export const formStatusEnum = pgEnum("form_status", [
  "draft", // not public yet
  "open", // public + accepting responses
  "closed", // public page shows "no longer accepting"
]);

export const form = pgTable(
  "form",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    title: text().notNull().default("Untitled form"),
    description: text(),
    // The "link half name": /f/<slug>. Globally unique so links are stable.
    slug: text().notNull().unique(),
    status: formStatusEnum().notNull().default("draft"),
    // Ordered field definitions — see FormField in lib/forms-shared.ts.
    fields: jsonb()
      .$type<import("@/lib/forms-shared").FormField[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    confirmationMessage: text()
      .notNull()
      .default("Thanks! Your response has been recorded."),
    // Notify church managers on each submission (toggleable).
    notifyEmail: boolean().notNull().default(true),
    notifyInApp: boolean().notNull().default(true),
    // Match-or-create a member from each response (using mapped fields).
    createMembers: boolean().notNull().default(true),
    addToFollowUp: boolean().notNull().default(false),
    responseCount: integer().notNull().default(0),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("form_church_idx").on(t.churchId)],
);

export const formResponse = pgTable(
  "form_response",
  {
    id: uuid().primaryKey().defaultRandom(),
    formId: uuid()
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    // Answers keyed by field id: { [fieldId]: value }.
    data: jsonb()
      .$type<Record<string, import("@/lib/forms-shared").FieldValue>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Linked member, when matched or created from the response.
    memberId: uuid().references(() => member.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("form_response_form_idx").on(t.formId),
    index("form_response_church_idx").on(t.churchId),
  ],
);

/* ============================================================
 * FlockInsight domain — devotionals & newsletters + subscribers
 * Churches publish devotionals/newsletters and bulk-send them by email to
 * members and to public newsletter subscribers. Sends can be scheduled.
 * ========================================================== */
export const devotionalTypeEnum = pgEnum("devotional_type", [
  "devotional",
  "newsletter",
]);
export const devotionalStatusEnum = pgEnum("devotional_status", [
  "draft",
  "scheduled",
  "sent",
]);

// Public newsletter subscribers (collected from the church's public page).
export const subscriber = pgTable(
  "subscriber",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    name: text(),
    email: text().notNull(),
    status: text().notNull().default("active"), // active | unsubscribed
    source: text().notNull().default("public"), // public | manual | member
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriber_church_idx").on(t.churchId),
    uniqueIndex("subscriber_church_email_idx").on(t.churchId, t.email),
  ],
);

export const devotional = pgTable(
  "devotional",
  {
    id: uuid().primaryKey().defaultRandom(),
    churchId: text()
      .notNull()
      .references(() => church.id, { onDelete: "cascade" }),
    type: devotionalTypeEnum().notNull().default("devotional"),
    title: text().notNull(),
    body: text().notNull(),
    imageUrl: text(),
    // Who receives it: subscribers | members | both.
    audience: text().notNull().default("both"),
    status: devotionalStatusEnum().notNull().default("draft"),
    scheduledAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    recipients: integer().notNull().default(0),
    sentCount: integer().notNull().default(0),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("devotional_church_idx").on(t.churchId),
    index("devotional_status_idx").on(t.status, t.scheduledAt),
  ],
);

/* ============================================================
 * Type helpers
 * ========================================================== */

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
export type Service = typeof service.$inferSelect;
export type NewService = typeof service.$inferInsert;
export type AttendanceSession = typeof attendanceSession.$inferSelect;
export type NewAttendanceSession = typeof attendanceSession.$inferInsert;
export type AttendanceRecord = typeof attendanceRecord.$inferSelect;
export type Church = typeof church.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type FollowUpInteraction = typeof followUpInteraction.$inferSelect;
export type NewFollowUpInteraction = typeof followUpInteraction.$inferInsert;
export type Group = typeof group.$inferSelect;
export type NewGroup = typeof group.$inferInsert;
export type GroupMembership = typeof groupMembership.$inferSelect;
export type NewGroupMembership = typeof groupMembership.$inferInsert;
export type GivingCategory = typeof givingCategory.$inferSelect;
export type NewGivingCategory = typeof givingCategory.$inferInsert;
export type Giving = typeof giving.$inferSelect;
export type NewGiving = typeof giving.$inferInsert;
export type Role = typeof role.$inferSelect;
export type NewRole = typeof role.$inferInsert;
export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
export type PushSubscription = typeof pushSubscription.$inferSelect;
export type Payment = typeof payment.$inferSelect;
export type SmsWalletTxn = typeof smsWalletTxn.$inferSelect;
export type WalletTxn = typeof walletTxn.$inferSelect;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Form = typeof form.$inferSelect;
export type NewForm = typeof form.$inferInsert;
export type FormResponse = typeof formResponse.$inferSelect;
export type Subscriber = typeof subscriber.$inferSelect;
export type Devotional = typeof devotional.$inferSelect;
export type NewDevotional = typeof devotional.$inferInsert;
