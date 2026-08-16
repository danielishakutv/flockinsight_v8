import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getLead, getLeadActivities, churchOptions } from "@/lib/leads";
import { LeadDetail } from "@/components/superadmin/lead-detail";

export const metadata = { title: "Lead · Admin" };

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A malformed id is simply "not found" — Postgres would otherwise reject the
  // uuid cast and turn a stale link into a server error.
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [lead, activities, churches] = await Promise.all([
    getLead(id),
    getLeadActivities(id),
    churchOptions(),
  ]);
  if (!lead) notFound();

  return (
    <div className="space-y-5">
      <Link
        href="/superadmin/growth"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> Back to the pipeline
      </Link>

      <LeadDetail
        lead={{
          ...lead,
          nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
          lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
          convertedAt: lead.convertedAt?.toISOString() ?? null,
          createdAt: lead.createdAt.toISOString(),
        }}
        activities={activities.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        }))}
        churches={churches.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
