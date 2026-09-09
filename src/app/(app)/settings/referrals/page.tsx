import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { referralSummary } from "@/lib/referrals";
import { referralUrl } from "@/lib/referral";
import {
  ReferralPanel,
  type ReferredRow,
} from "@/components/settings/referral-panel";

export const metadata = { title: "Referrals · Settings" };

/** Reflects a referral the moment it happens, so it is never stale. */
export const dynamic = "force-dynamic";

export default async function ReferralsSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("settings.manage");

  const summary = await referralSummary(church.id);
  const link = referralUrl({ handle: church.handle, slug: church.slug });

  const churches: ReferredRow[] = summary.churches.map((c) => ({
    id: c.id,
    name: c.name,
    // Dates cross to the client as strings; the panel formats them there.
    joinedAt: c.joinedAt ? c.joinedAt.toISOString() : null,
    subscribed: c.subscribed,
    rewarded: !!c.rewardedAt,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Referrals</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tell another church about FlockInsight and earn wallet credit when
          they subscribe.
        </p>
      </div>

      <ReferralPanel
        link={link}
        currency={church.currency}
        rewards={summary.rewards}
        summary={{
          total: summary.total,
          subscribed: summary.subscribed,
          pending: summary.pending,
          earned: summary.earned,
        }}
        churches={churches}
      />
    </div>
  );
}
