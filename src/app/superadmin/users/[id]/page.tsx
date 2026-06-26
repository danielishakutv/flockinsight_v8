import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { church, staff, user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { UserDetail } from "@/components/superadmin/user-detail";

export const metadata = { title: "User · Admin" };

export default async function SuperadminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = await requireSuperAdmin();

  const [u] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  if (!u) notFound();

  const [memberships, churches] = await Promise.all([
    db
      .select({
        churchId: staff.organizationId,
        churchName: church.name,
        role: staff.role,
      })
      .from(staff)
      .innerJoin(church, eq(church.id, staff.organizationId))
      .where(eq(staff.userId, id))
      .orderBy(asc(church.name)),
    db
      .select({ id: church.id, name: church.name })
      .from(church)
      .orderBy(asc(church.name))
      .limit(1000),
  ]);

  return (
    <UserDetail
      currentAdminId={admin.id}
      user={{
        id: u.id,
        name: u.name,
        email: u.email,
        isSuperAdmin: u.isSuperAdmin,
        mustChangePassword: u.mustChangePassword,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
      }}
      memberships={memberships}
      churches={churches}
    />
  );
}
