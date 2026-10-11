import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { requireUser } from "@/lib/session";
import {
  hasOpenPayout,
  partnerChurches,
  partnerEarnings,
  partnerForUser,
  partnerPayouts,
  partnerTierNow,
  partnerWallet,
} from "@/lib/partners";
import { nextTier } from "@/lib/partners-shared";
import { partnerShareLink } from "@/lib/partner-link";
import { siteUrl } from "@/lib/site";
import { PartnerDashboard } from "@/components/partners/partner-dashboard";

export const metadata = { title: "Partner dashboard" };
export const dynamic = "force-dynamic";

/**
 * A Partner's own dashboard, outside the church app entirely.
 *
 * Deliberately NOT under `(app)`: that layout is built around "the church you
 * are currently in", with its church switcher, its plan gates and its
 * church-scoped navigation. A Partner is not in a church — they are a person
 * who brings churches — and putting them inside that shell would have meant
 * giving them a church to be inside, which is the one thing this module must
 * never do.
 */
export default async function PartnerPage() {
  const { user } = await requireUser();
  const me = await partnerForUser(user.id);

  // Not a Partner: send them to the page that explains the programme and lets
  // them apply, rather than showing an empty dashboard.
  if (!me) redirect("/partner/join");

  const [wallet, churches, earnings, payouts, openRequest, tierNow] =
    await Promise.all([
      partnerWallet(me.id),
      partnerChurches(me.id),
      partnerEarnings(me.id),
      partnerPayouts(me.id),
      hasOpenPayout(me.id),
      partnerTierNow(me.id, me.tierOverride),
    ]);

  const ahead = nextTier(tierNow.rates, tierNow.liveChurches);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
          <Handshake className="text-primary size-6" />
          Partner dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {me.displayName}. Everything you have brought in, and
          everything you have earned.
        </p>
      </div>

      <PartnerDashboard
        partner={{
          id: me.id,
          code: me.code,
          displayName: me.displayName,
          status: me.status,
          phone: me.phone,
          emailVerified: !!me.emailVerifiedAt,
          phoneVerified: !!me.phoneVerifiedAt,
          bankName: me.bankName,
          bankAccountNumber: me.bankAccountNumber,
          bankAccountName: me.bankAccountName,
        }}
        email={user.email ?? ""}
        shareLink={partnerShareLink(siteUrl(), me.code)}
        wallet={wallet}
        rates={tierNow.rates}
        tier={tierNow.tier}
        liveChurches={tierNow.liveChurches}
        ahead={ahead}
        openRequest={openRequest}
        churches={churches}
        earnings={earnings.map((e) => ({
          id: e.id,
          kind: e.kind,
          amount: Number(e.amount),
          currency: e.currency,
          rateBps: e.rateBps,
          status: e.status,
          churchName: e.churchName,
          createdAt: e.createdAt.toISOString(),
        }))}
        payouts={payouts.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          reference: p.reference,
          requestedAt: p.requestedAt.toISOString(),
          paidAt: p.paidAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
