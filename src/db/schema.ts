import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

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
]);
// SMS wallet ledger entry direction.
export const smsTxnKindEnum = pgEnum("sms_txn_kind", ["credit", "debit"]);
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
  // ----- SMS -----
  smsSenderId: text(), // requested/approved sender ID (<=11 chars)
  smsSenderStatus: smsSenderStatusEnum().notNull().default("none"),
  smsSenderNote: text(), // application note / rejection reason
  smsBalance: numeric({ precision: 14, scale: 2, mode: "number" })
    .notNull()
    .default(0),
});

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
    dateOfBirth: date(),
    status: memberStatusEnum().notNull().default("active"),
    joinedAt: date(),
    photoUrl: text(),
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
  (t) => [index("member_church_idx").on(t.churchId)],
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
