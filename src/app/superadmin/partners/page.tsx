import { Handshake } from "lucide-react";
import { requirePlatform } from "@/lib/platform-access";
import { allPartners, getPartnerRates, pendingPayouts } from "@/lib/partners";
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

  const [rates, partners, payouts] = await Promise.all([
    getPartnerRates(),
    allPartners(),
    pendingPayouts(),
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
        rates={rates}
        partners={partners.map((p) => ({
          id: p.id,
          code: p.code,
          displayName: p.displayName,
          status: p.status,
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
          partnerName: p.partnerName,
          partnerCode: p.partnerCode,
        }))}
      />
    </div>
  );
}
