import { Handshake } from "lucide-react";
import { and, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { partner } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { allPartners, getPartnerRates, pendingPayouts } from "@/lib/partners";
import { latestDigestDay, partnerDigestEnabled } from "@/lib/partner-digest";
import { nextDigestAt } from "@/lib/partner-digest-shared";
import { PartnersAdmin } from "@/components/superadmin/partners-admin";

export const metadata = { title: "Partners · Admin" };
export const dynamic = "force-dynamic";

/**
 * The platform side of the Partner programme: the ladder, the people, and the
 * withdrawals waiting to be paid.
 *
 * Behind `platform.finance.manage` — the permission that already means "move
 * money" — rather than a new key nobody has been granted.
 */
export default async function SuperadminPartnersPage() {
  await requirePlatform("platform.finance.manage");

  const now = new Date();
  const [rates, partners, payouts, digestOn, latestDay, [optedOut], [untold]] =
    await Promise.all([
      getPartnerRates(),
      allPartners(),
      pendingPayouts(),
      partnerDigestEnabled(),
      latestDigestDay(),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(partner)
        .where(isNotNull(partner.digestOptOutAt)),
      // Status emails not yet accepted, inside the three days they are retried.
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(partner)
        .where(
          and(
            gt(partner.statusChangedAt, new Date(now.getTime() - 3 * 86_400_000)),
            or(
              isNull(partner.statusNotifiedAt),
              lt(partner.statusNotifiedAt, partner.statusChangedAt),
            ),
          ),
        ),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
          <Handshake className="text-primary size-6" />
          Partners
        </h1>
        <p className="text-muted-foreground mt-1">
          The field agents who bring churches, what they earn, and the
          withdrawals waiting on you.
        </p>
      </div>

      <PartnersAdmin
        emails={{
          enabled: digestOn,
          // Written here, in Lagos time, so the server render and the
          // browser's agree whatever zone either is in.
          nextLabel: `${new Intl.DateTimeFormat("en-GB", {
            timeZone: "Africa/Lagos",
            weekday: "long",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }).format(nextDigestAt(now))} (Lagos)`,
          latest: latestDay,
          optedOut: Number(optedOut?.n ?? 0),
          untoldStatus: Number(untold?.n ?? 0),
        }}
        rates={rates}
        partners={partners.map((p) => ({
          id: p.id,
          code: p.code,
          displayName: p.displayName,
          status: p.status,
          email: p.email,
          phone: p.phone,
          emailVerified: !!p.emailVerifiedAt,
          phoneVerified: !!p.phoneVerifiedAt,
          tierOverride: p.tierOverride,
          churches: Number(p.churches),
          createdAt: p.createdAt.toISOString(),
        }))}
        payouts={payouts.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          bankName: p.bankName,
          bankAccountNumber: p.bankAccountNumber,
          bankAccountName: p.bankAccountName,
          requestedAt: p.requestedAt.toISOString(),
          partnerId: p.partnerId,
          partnerName: p.partnerName,
          partnerCode: p.partnerCode,
          partnerStatus: p.partnerStatus,
        }))}
      />
    </div>
  );
}
