import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { role, staff } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { ensureDefaultRoles, requireCan } from "@/lib/permissions";
import { RolesManager, type RoleRow } from "@/components/settings/roles-manager";

export const metadata = { title: "Roles · Settings" };

export default async function RolesSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("team.manage");
  await ensureDefaultRoles(church.id);

  const roles = await db
    .select({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      members: count(staff.id),
    })
    .from(role)
    .leftJoin(staff, eq(staff.roleId, role.id))
    .where(eq(role.churchId, church.id))
    .groupBy(role.id)
    .orderBy(desc(role.isSystem), asc(role.name));

  const rows: RoleRow[] = roles.map((r) => ({
    ...r,
    members: Number(r.members),
  }));

  return <RolesManager roles={rows} />;
}
