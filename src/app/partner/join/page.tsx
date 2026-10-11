import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getPartnerRates, partnerForUser } from "@/lib/partners";
import { PartnerJoin } from "@/components/partners/partner-join";

export const metadata = { title: "Become a Partner" };
export const dynamic = "force-dynamic";

/**
 * What the programme is, and the one form that joins it.
 *
 * The rates are read from the live settings rather than written into the copy,
 * so a superadmin changing the ladder changes what this page promises. A page
 * that advertises 40% while the system pays 35% is worse than no page.
 */
export default async function PartnerJoinPage() {
  const { user } = await requireUser();
  if (await partnerForUser(user.id)) redirect("/partner");

  const rates = await getPartnerRates();
  const base = rates.tiers[0];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
          <Handshake className="text-primary size-6" />
          Become a FlockInsight Partner
        </h1>
        <p className="text-muted-foreground mt-1">
          Bring churches onto FlockInsight and earn on what they pay — for as
          long as they stay.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border p-4 text-sm">
        <p className="font-semibold">How it works</p>
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5">
          <li>
            You get a short referral code and a link. Any church that signs up
            within 30 days of following it is credited to you — or you can walk
            them through signing up with your code there and then.
          </li>
          <li>
            You earn <strong>{(base.firstBps / 100).toFixed(0)}%</strong> of each
            church&rsquo;s first two payments.
            {rates.trailBps > 0 && (
              <>
                {" "}
                After that you keep earning{" "}
                <strong>{(rates.trailBps / 100).toFixed(0)}%</strong> of every
                payment for {rates.trailMonths} months.
              </>
            )}
          </li>
          <li>
            The more churches you have live and paying, the higher your rate:{" "}
            {rates.tiers
              .slice(1)
              .map(
                (t) =>
                  `${t.minChurches}+ churches is ${(t.firstBps / 100).toFixed(0)}% as a ${t.name}`,
              )
              .join(", ")}
            .
          </li>
          <li>
            Withdraw to your bank account any time you have{" "}
            {rates.minPayout.toLocaleString()} or more.
          </li>
          <li>
            You can raise a support ticket on behalf of any church you brought,
            and see how each one is doing — their plan, whether they are paying,
            and what you have earned.{" "}
            <strong>You never see a church&rsquo;s members or their giving.</strong>
          </li>
        </ul>
      </div>

      <PartnerJoin defaultName={user.name ?? ""} />
    </div>
  );
}
