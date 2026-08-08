"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";

export type PaletteEntry = {
  id: string;
  label: string;
  sub: string;
  href: string;
  kind: "church" | "user";
};

/**
 * Everything the command palette can jump to. Fetched once when the palette
 * first opens, then filtered on the client — at this scale that is far faster
 * than a round trip per keystroke.
 */
export async function loadPaletteEntries(): Promise<PaletteEntry[]> {
  await requireSuperAdmin();

  const [churches, owners, users] = await Promise.all([
    db
      .select({
        id: church.id,
        name: church.name,
        slug: church.slug,
        status: church.status,
      })
      .from(church)
      .orderBy(desc(church.createdAt))
      .limit(500),
    db
      .select({ orgId: staff.organizationId, email: user.email })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(eq(staff.role, "owner")),
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(500),
  ]);

  const ownerMap = new Map(owners.map((o) => [o.orgId, o.email]));

  return [
    ...churches.map((c) => ({
      id: `church-${c.id}`,
      label: c.name,
      sub: `/${c.slug}${ownerMap.get(c.id) ? ` · ${ownerMap.get(c.id)}` : ""}${
        c.status === "suspended" ? " · suspended" : ""
      }`,
      href: `/superadmin/churches/${c.id}`,
      kind: "church" as const,
    })),
    ...users.map((u) => ({
      id: `user-${u.id}`,
      label: u.name || u.email,
      sub: u.email,
      href: `/superadmin/users/${u.id}`,
      kind: "user" as const,
    })),
  ];
}
