import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { MemberEditForm } from "@/components/members/member-edit-form";

export const metadata = { title: "Member" };

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();

  const [m] = await db
    .select({
      id: member.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      gender: member.gender,
      status: member.status,
      phone: member.phone,
      email: member.email,
      dateOfBirth: member.dateOfBirth,
      joinedAt: member.joinedAt,
      house: member.house,
      street: member.street,
      city: member.city,
      lga: member.lga,
      state: member.state,
      country: member.country,
      notes: member.notes,
    })
    .from(member)
    .where(and(eq(member.id, id), eq(member.churchId, church.id)))
    .limit(1);

  if (!m) notFound();

  const name = [m.firstName, m.middleName, m.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <PageContainer className="max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/members">
          <ArrowLeft className="size-4" />
          Members
        </Link>
      </Button>
      <h1 className="text-3xl font-extrabold tracking-tight">{name}</h1>
      <p className="text-muted-foreground mb-6 mt-1">
        Complete this member&apos;s profile.
      </p>
      <MemberEditForm member={m} />
    </PageContainer>
  );
}
