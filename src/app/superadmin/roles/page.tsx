import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformRole, user } from "@/db/schema";
import { canPlatform, requirePlatform } from "@/lib/platform-access";
import { RolesAdmin } from "@/components/superadmin/roles-admin";

export const metadata = { title: "Admin roles · Admin" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const me = await requirePlatform("platform.roles.manage");
  // Handing out or taking away platform access is a users.manage act, so the
  // page shows the roles either way but only offers the buttons to those who
  // may actually use them.
  const canManageAdmins = await canPlatform("platform.users.manage");

  const [roles, admins] = await Promise.all([
    db.select().from(platformRole).orderBy(asc(platformRole.name)),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        roleId: user.platformRoleId,
        roleName: platformRole.name,
      })
      .from(user)
      .leftJoin(platformRole, eq(platformRole.id, user.platformRoleId))
      .where(eq(user.isSuperAdmin, true)),
  ]);

  // How many admins sit on each role, so deleting one can say what it would
  // affect before you try.
  const counts = await db
    .select({ roleId: user.platformRoleId, n: count() })
    .from(user)
    .where(eq(user.isSuperAdmin, true))
    .groupBy(user.platformRoleId);
  const held = new Map(counts.map((c) => [c.roleId, Number(c.n)]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin roles</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Who can reach what on the platform side. An admin with no role has
          full access.
        </p>
      </div>

      <RolesAdmin
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          permissions: r.permissions ?? [],
          held: held.get(r.id) ?? 0,
        }))}
        admins={admins.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          roleId: a.roleId,
          roleName: a.roleName,
          isSelf: a.id === me.id,
        }))}
        canManageAdmins={canManageAdmins}
      />
    </div>
  );
}
