import Link from "next/link";
import { Home } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { ensureSignup, signupUrl } from "@/lib/member-signup";
import { householdOptions } from "@/lib/households";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { MembersList, type MemberRow } from "@/components/members/members-list";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const { church } = await requireChurch();
  await requireCan("members.view");
  const canManage = await can("members.manage");

  const raw = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      gender: member.gender,
      phone: member.phone,
      email: member.email,
      status: member.status,
      dateOfBirth: member.dateOfBirth,
      notes: member.notes,
      isMinor: member.isMinor,
      guardianId: member.guardianId,
    })
    .from(member)
    .where(eq(member.churchId, church.id))
    .orderBy(asc(member.firstName), asc(member.lastName));

  // Resolve each child's guardian name from the same list (all members are
  // loaded here anyway), so we avoid a self-join.
  const nameById = new Map(
    raw.map((r) => [
      r.id,
      [r.firstName, r.lastName].filter(Boolean).join(" "),
    ]),
  );
  const rows: MemberRow[] = raw.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    gender: r.gender,
    phone: r.phone,
    email: r.email,
    status: r.status,
    dateOfBirth: r.dateOfBirth,
    notes: r.notes,
    isMinor: r.isMinor,
    guardianName: r.guardianId ? nameById.get(r.guardianId) ?? null : null,
  }));

  const active = rows.filter((r) => r.status === "active").length;
  const visitors = rows.filter((r) => r.status === "visitor").length;
  const children = rows.filter((r) => r.isMinor).length;

  // The public self-registration link + household options (only for managers).
  const [signup, households] = await Promise.all([
    canManage
      ? ensureSignup({ id: church.id, name: church.name, handle: church.handle })
      : Promise.resolve(null),
    canManage ? householdOptions(church.id) : Promise.resolve([]),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Members"
        description={`${rows.length} total · ${active} active · ${visitors} visitor${visitors === 1 ? "" : "s"}${children ? ` · ${children} child${children === 1 ? "" : "ren"}` : ""}`}
        action={
          <Button asChild variant="outline">
            <Link href="/members/households">
              <Home className="size-4" />
              Households
            </Link>
          </Button>
        }
      />
      <MembersList
        members={rows}
        canManage={canManage}
        signupUrl={signup ? signupUrl(signup.slug) : undefined}
        signupEnabled={signup?.enabled ?? false}
        households={households}
      />
    </PageContainer>
  );
}
