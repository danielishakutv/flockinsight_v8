import { count } from "drizzle-orm";
import { Layers } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { getTierDeltas, listCustomPlans, loadCatalog } from "@/lib/plan-catalog";
import { getAllPlanEmails, getAllPlanStorageMb, getPlanPrices } from "@/lib/pricing";
import { PLAN_ORDER, TEAM_LIMIT_BY_PLAN } from "@/lib/entitlements";
import { PLAN_BY_ID, planKeyOf } from "@/lib/plans";
import { PlansAdmin } from "@/components/superadmin/plans-admin";

export const metadata = { title: "Plans & features · Admin" };

export default async function SuperadminPlansPage() {
  await requirePlatform("platform.pricing.manage");
  const [catalog, deltas, customs, prices, storageMb, emails, onPlan] = await Promise.all([
    loadCatalog(),
    getTierDeltas(),
    listCustomPlans({ includeArchived: true }),
    getPlanPrices(),
    getAllPlanStorageMb(),
    getAllPlanEmails(),
    db
      .select({ plan: church.plan, customPlanId: church.customPlanId, n: count() })
      .from(church)
      .groupBy(church.plan, church.customPlanId),
  ]);

  // How many churches each change would reach, said before it is saved.
  const churches: Record<string, number> = {};
  for (const r of onPlan) {
    const key = planKeyOf(r);
    churches[key] = (churches[key] ?? 0) + Number(r.n);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
          <Layers className="text-primary size-6" />
          Plans &amp; features
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Tick what each plan includes, and make plans of your own — a student
          fellowship plan, a price agreed with one denomination. What you tick
          here is what churches can use: the menu, the upgrade prompts and the
          server all read it.
        </p>
      </div>

      <PlansAdmin
        tiers={catalog.tiers}
        changed={Object.fromEntries(
          PLAN_ORDER.map((t) => [t, deltas[t].added.length + deltas[t].removed.length]),
        ) as Record<(typeof PLAN_ORDER)[number], number>}
        churches={churches}
        tierDefaults={Object.fromEntries(
          PLAN_ORDER.map((t) => [
            t,
            {
              price: prices[t],
              memberLimit: PLAN_BY_ID[t].memberLimit,
              teamLimit: TEAM_LIMIT_BY_PLAN[t],
              emailAllowance: emails[t],
              storageMb: storageMb[t],
            },
          ]),
        ) as Parameters<typeof PlansAdmin>[0]["tierDefaults"]}
        customPlans={customs.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          tagline: c.tagline,
          basePlan: c.basePlan,
          priceMonthly: c.priceMonthly,
          memberLimit: c.memberLimit,
          teamLimit: c.teamLimit,
          emailAllowance: c.emailAllowance,
          storageMb: c.storageMb,
          features: [...(catalog.custom[c.id]?.features ?? catalog.tiers[c.basePlan])],
          highlights: c.highlights,
          showOnWebsite: c.showOnWebsite,
          sortOrder: c.sortOrder,
          archived: !!c.archivedAt,
        }))}
      />
    </div>
  );
}
