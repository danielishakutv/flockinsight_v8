import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getProject } from "@/lib/projects";
import { getGivingReceiptSetting } from "@/lib/giving-receipts";
import { PageContainer } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ProjectDetail } from "@/components/giving/project-detail";

export const metadata = { title: "Project · Giving" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const { church } = await requireChurch();
  await requireCan("giving.view");
  const canManage = await can("giving.manage");

  const [detail, members, receipt] = await Promise.all([
    getProject(church.id, id),
    db
      .select({ id: member.id, firstName: member.firstName, lastName: member.lastName })
      .from(member)
      .where(eq(member.churchId, church.id))
      .orderBy(asc(member.firstName), asc(member.lastName)),
    getGivingReceiptSetting(church.id),
  ]);
  if (!detail) notFound();

  return (
    <PageContainer className="max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/giving/projects">
          <ArrowLeft className="size-4" />
          Projects
        </Link>
      </Button>
      <ProjectDetail
        project={detail}
        canManage={canManage}
        currency={church.currency}
        today={new Date().toISOString().slice(0, 10)}
        members={members.map((m) => ({
          id: m.id,
          name: [m.firstName, m.lastName].filter(Boolean).join(" "),
        }))}
        receiptsEnabled={receipt.enabled}
      />
    </PageContainer>
  );
}
