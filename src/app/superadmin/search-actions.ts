"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { platformAccess } from "@/lib/platform-access";

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
 *
 * Scoped by the admin's role, not just "is an admin". The palette is mounted
 * for every admin, and this used to answer every one of them with 500 churches,
 * each owner's email and 500 users' emails — so a blog editor (content.manage
 * only) pressing ⌘K received the whole account list their role was written to
 * withhold. Clicking a result would have been refused; the data had already
 * been sent. Now each half needs the permission its own page needs:
 *
 * - churches: platform.churches.view (the /superadmin/churches gate);
 * - users, and the owner email shown beside a church: platform.users.view.
 *
 * Holding neither returns [] — the palette then has nothing to search, which
 * is the truth for that role, not an error.
 */
export async function loadPaletteEntries(): Promise<PaletteEntry[]> {
  const access = await platformAccess();
  if (!access) return [];
  const seeChurches = access.perms.has("platform.churches.view");
  const seeUsers = access.perms.has("platform.users.view");
  if (!seeChurches && !seeUsers) return [];

  const [churches, owners, users] = await Promise.all([
    seeChurches
      ? db
          .select({
            id: church.id,
            name: church.name,
            slug: church.slug,
            status: church.status,
          })
          .from(church)
          .orderBy(desc(church.createdAt))
          .limit(500)
      : Promise.resolve([]),
    seeChurches && seeUsers
      ? db
          .select({ orgId: staff.organizationId, email: user.email })
          .from(staff)
          .innerJoin(user, eq(user.id, staff.userId))
          .where(eq(staff.role, "owner"))
      : Promise.resolve([]),
    seeUsers
      ? db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .orderBy(desc(user.createdAt))
          .limit(500)
      : Promise.resolve([]),
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
