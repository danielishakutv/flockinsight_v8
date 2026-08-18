import Link from "next/link";
import { asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import { listCampaigns } from "@/lib/outreach";
import { leadSources, pipelineStats } from "@/lib/leads";
import { listDenominations } from "@/lib/denominations";
import { isSmsConfigured } from "@/lib/sms";
import { isEmailConfigured } from "@/lib/mailer";
import { OutreachComposer } from "@/components/superadmin/outreach-composer";
import { CampaignHistory } from "@/components/superadmin/campaign-history";

export const metadata = { title: "Outreach · Admin" };

export default async function OutreachPage() {
  const [churches, countryRows, sources, stats, campaigns, denominations] =
    await Promise.all([
      db
        .select({ id: church.id, name: church.name, plan: church.plan })
        .from(church)
        .orderBy(asc(church.name)),
      db
        .selectDistinct({ country: church.country })
        .from(church)
        .orderBy(asc(church.country)),
      leadSources(),
      pipelineStats(),
      listCampaigns(30),
      listDenominations(),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/superadmin/growth"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" /> Back to the pipeline
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Outreach</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Email and SMS to churches already on FlockInsight, or to leads
          you&rsquo;re still chasing.
        </p>
      </div>

      <OutreachComposer
        churches={churches}
        countries={countryRows.map((c) => c.country).filter(Boolean)}
        sources={sources}
        denominations={denominations
          .filter((d) => !d.archived && d.churches > 0)
          .map((d) => ({ id: d.id, name: d.name, churches: d.churches }))}
        leadCounts={stats.byStatus}
        openLeads={stats.open}
        totalLeads={stats.total}
        emailReady={isEmailConfigured()}
        smsReady={isSmsConfigured()}
      />

      <CampaignHistory
        campaigns={campaigns.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
