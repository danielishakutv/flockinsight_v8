import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { user, staff, church } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { UsersAdmin, type UserRow } from "@/components/superadmin/users-admin";

export const metadata = { title: "Users · Admin" };

export default async function SuperadminUsersPage() {
  await requireSuperAdmin();

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      churches: sql<string>`coalesce(string_agg(distinct ${church.name}, ', '), '')`,
    })
    .from(user)
    .leftJoin(staff, and(eq(staff.userId, user.id), eq(staff.temp, false)))
    .leftJoin(church, eq(church.id, staff.organizationId))
    .groupBy(user.id)
    .orderBy(desc(user.createdAt))
    .limit(500);

  const users: UserRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    isSuperAdmin: r.isSuperAdmin,
    churches: r.churches,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Users</h1>
        <p className="text-muted-foreground mt-1">
          {users.length} account{users.length === 1 ? "" : "s"}. Reset passwords
          for locked-out users or manage admins.
        </p>
      </div>
      <UsersAdmin users={users} />
    </div>
  );
}
