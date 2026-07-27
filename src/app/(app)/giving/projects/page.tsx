import Link from "next/link";
import { ArrowLeft, ListChecks } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { listProjects } from "@/lib/projects";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ProjectsManager } from "@/components/giving/projects-manager";

export const metadata = { title: "Projects · Giving" };

export default async function ProjectsPage() {
  const { church } = await requireChurch();
  await requireCan("giving.view");
  const canManage = await can("giving.manage");

  const projects = await listProjects(church.id);

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/giving">
          <ArrowLeft className="size-4" />
          Giving
        </Link>
      </Button>
      <PageHeader
        title="Projects & pledges"
        description="Run building funds and other campaigns — track pledges and payments to completion."
        action={
          <Button asChild variant="outline">
            <Link href="/giving/projects/report">
              <ListChecks className="size-4" />
              <span className="hidden sm:inline">Outstanding</span>
            </Link>
          </Button>
        }
      />
      <ProjectsManager
        projects={projects}
        canManage={canManage}
        currency={church.currency}
      />
    </PageContainer>
  );
}
