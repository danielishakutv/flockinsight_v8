import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, member, roadmapItem, user } from "@/db/schema";
import type { RoadmapPriority, RoadmapStatus } from "@/lib/roadmap-shared";

export type RoadmapRow = typeof roadmapItem.$inferSelect;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Everything, ordered the way the board reads: within a status, by explicit
 * position, then newest first. Shipped items are the exception — those read
 * by ship date, because a timeline is only ever chronological.
 */
export async function listRoadmap(): Promise<RoadmapRow[]> {
  return db
    .select()
    .from(roadmapItem)
    .orderBy(
      asc(roadmapItem.position),
      desc(roadmapItem.shippedAt),
      desc(roadmapItem.createdAt),
    );
}

export async function getRoadmapItem(id: string): Promise<RoadmapRow | null> {
  const [row] = await db
    .select()
    .from(roadmapItem)
    .where(eq(roadmapItem.id, id))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------ *
 * Platform size snapshot
 * ------------------------------------------------------------------ */

export type PlatformSize = {
  churches: number;
  users: number;
  members: number;
};

/**
 * How big the platform is right now.
 *
 * Three numbers because "users" is ambiguous in a multi-tenant church app and
 * picking one would quietly mislead later: `churches` is paying tenants,
 * `users` is people with a login (staff/pastors), and `members` is the
 * congregations they between them look after — by far the largest, and the
 * one that says how many people the platform actually touches.
 */
export async function platformSize(): Promise<PlatformSize> {
  const [churches, users, members] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(church),
    db.select({ n: sql<number>`count(*)::int` }).from(user),
    db.select({ n: sql<number>`count(*)::int` }).from(member),
  ]);
  return {
    churches: churches[0]?.n ?? 0,
    users: users[0]?.n ?? 0,
    members: members[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type RoadmapInput = {
  title: string;
  detail?: string | null;
  status?: RoadmapStatus;
  priority?: RoadmapPriority;
  area?: string | null;
  targetDate?: string | null;
  isPublic?: boolean;
  version?: string | null;
};

export async function createRoadmapItem(
  input: RoadmapInput & { createdBy?: string | null },
): Promise<RoadmapRow> {
  const status = input.status ?? "idea";
  // New work goes to the end of its column rather than the top: the queue is
  // an order of intent, and something just thought of shouldn't outrank
  // everything already agreed.
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${roadmapItem.position}), 0) + 1` })
    .from(roadmapItem)
    .where(eq(roadmapItem.status, status));

  const shipping = status === "shipped";
  const size = shipping ? await platformSize() : null;

  const [row] = await db
    .insert(roadmapItem)
    .values({
      title: input.title,
      detail: input.detail ?? null,
      status,
      priority: input.priority ?? "medium",
      area: input.area ?? null,
      targetDate: input.targetDate ?? null,
      isPublic: input.isPublic ?? false,
      version: input.version ?? null,
      position: next,
      createdBy: input.createdBy ?? null,
      startedAt: status === "in_progress" ? new Date() : null,
      shippedAt: shipping ? new Date() : null,
      churchesAtShip: size?.churches ?? null,
      usersAtShip: size?.users ?? null,
      membersAtShip: size?.members ?? null,
    })
    .returning();
  return row;
}

export async function updateRoadmapItem(
  id: string,
  input: RoadmapInput,
): Promise<void> {
  await db
    .update(roadmapItem)
    .set({
      title: input.title,
      detail: input.detail ?? null,
      priority: input.priority ?? "medium",
      area: input.area ?? null,
      targetDate: input.targetDate ?? null,
      isPublic: input.isPublic ?? false,
      version: input.version ?? null,
    })
    .where(eq(roadmapItem.id, id));
}

/**
 * Move an item to another status.
 *
 * Moving something to `shipped` is what freezes the platform size. It happens
 * once: an item moved out of shipped and back in keeps the original stamps,
 * so a mis-click doesn't rewrite history with today's larger numbers. Clearing
 * them deliberately is what `unship` is for.
 */
export async function setRoadmapStatus(
  id: string,
  status: RoadmapStatus,
  opts: { version?: string | null } = {},
): Promise<void> {
  const current = await getRoadmapItem(id);
  if (!current) return;

  const patch: Partial<typeof roadmapItem.$inferInsert> = { status };

  if (status === "in_progress" && !current.startedAt) {
    patch.startedAt = new Date();
  }

  if (status === "shipped") {
    if (!current.shippedAt) {
      const size = await platformSize();
      patch.shippedAt = new Date();
      patch.churchesAtShip = size.churches;
      patch.usersAtShip = size.users;
      patch.membersAtShip = size.members;
    }
    if (opts.version !== undefined) patch.version = opts.version;
  }

  await db.update(roadmapItem).set(patch).where(eq(roadmapItem.id, id));
}

/** Undo a ship: clears the date, the version and the frozen size. */
export async function unshipRoadmapItem(
  id: string,
  status: RoadmapStatus = "planned",
): Promise<void> {
  await db
    .update(roadmapItem)
    .set({
      status,
      shippedAt: null,
      version: null,
      churchesAtShip: null,
      usersAtShip: null,
      membersAtShip: null,
    })
    .where(eq(roadmapItem.id, id));
}

export async function deleteRoadmapItem(id: string): Promise<void> {
  await db.delete(roadmapItem).where(eq(roadmapItem.id, id));
}

/** Reorder within a column. Positions are rewritten to match the given order. */
export async function reorderRoadmap(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await Promise.all(
    ids.map((id, i) =>
      db.update(roadmapItem).set({ position: i + 1 }).where(eq(roadmapItem.id, id)),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Feed
 * ------------------------------------------------------------------ */

export type FeedItem = {
  id: string;
  title: string;
  detail?: string | null;
  status: string;
  area: string | null;
  priority?: string;
  version: string | null;
  shippedAt: string | null;
  targetDate?: string | null;
  isPublic?: boolean;
  platformAtShip?: PlatformSize | null;
};

/**
 * The roadmap as JSON.
 *
 * `full` is the operator's view — every item, the spec, the priority and the
 * frozen platform size. The public view is deliberately thinner: only items
 * ticked public, and no counts at all. How many churches were on the platform
 * the day something shipped is a business number, not a product announcement,
 * and it stays behind the key even for an item that's otherwise public.
 */
export async function roadmapFeed(full: boolean): Promise<FeedItem[]> {
  const rows = await listRoadmap();
  const visible = full ? rows : rows.filter((r) => r.isPublic);

  return visible.map((r) =>
    full
      ? {
          id: r.id,
          title: r.title,
          detail: r.detail,
          status: r.status,
          priority: r.priority,
          area: r.area,
          version: r.version,
          targetDate: r.targetDate,
          isPublic: r.isPublic,
          shippedAt: r.shippedAt ? r.shippedAt.toISOString() : null,
          platformAtShip: r.shippedAt
            ? {
                churches: r.churchesAtShip ?? 0,
                users: r.usersAtShip ?? 0,
                members: r.membersAtShip ?? 0,
              }
            : null,
        }
      : {
          id: r.id,
          title: r.title,
          status: r.status,
          area: r.area,
          version: r.version,
          shippedAt: r.shippedAt ? r.shippedAt.toISOString() : null,
        },
  );
}

/**
 * Does this request carry the feed key?
 *
 * Unset env = no key access at all, rather than a feed that anyone can read
 * by sending an empty key.
 */
export function hasFeedKey(supplied: string | null): boolean {
  const expected = process.env.ROADMAP_FEED_KEY;
  if (!expected) return false;
  if (!supplied) return false;
  // Constant-time-ish: compare full length regardless of where they diverge.
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * Turn the shipped changelog into roadmap history, once.
 *
 * The changelog already records what went out and when, so the "already
 * deployed" half of the board doesn't have to be retyped. Platform size is
 * left null for these: those releases happened before anything was counting,
 * and inventing a number would be worse than admitting we don't have one.
 */
export async function seedFromChangelog(
  releases: { version: string; date: string; summary?: string }[],
  createdBy: string | null,
): Promise<number> {
  const existing = await db
    .select({ version: roadmapItem.version })
    .from(roadmapItem)
    .where(sql`${roadmapItem.version} is not null`);
  const have = new Set(existing.map((r) => r.version));

  const rows = releases
    .filter((r) => !have.has(r.version))
    .map((r, i) => ({
      title: `v${r.version}`,
      detail: r.summary ?? null,
      status: "shipped" as const,
      priority: "medium" as const,
      area: "Platform",
      version: r.version,
      isPublic: false,
      position: i + 1,
      shippedAt: new Date(`${r.date}T12:00:00Z`),
      createdBy,
    }));

  if (rows.length === 0) return 0;
  await db.insert(roadmapItem).values(rows);
  return rows.length;
}
