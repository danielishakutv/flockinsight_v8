import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake } from "lucide-react";
import { getMyChurches, getSession } from "@/lib/session";
import { getPartnerRates, partnerForUser } from "@/lib/partners";
import {
  PartnerJoin,
  PartnerSignup,
} from "@/components/partners/partner-join";

export const metadata = {
  title: "Become a Partner",
  // A sign-up form, not a page to rank: /partners is the one that explains.
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * What the programme is, and the form that joins it.
 *
 * Open to everybody. It used to call `requireUser()`, so the link every
 * Partner page and the public /partners page points at sent a newcomer to a
 * login screen for an account they did not have — and, once they had signed
 * in, dropped them on their church dashboard instead of back here.
 *
 * Who is looking decides the form:
 *
 * - signed out: create a Partner account (no church), or log in with the
 *   account you already have and come back here;
 * - signed in: join with THIS account. A church owner, a member of staff or
 *   a platform operator becomes a Partner on the same login, with their
 *   church access untouched;
 * - already a Partner: the dashboard.
 *
 * The rates are read from the live settings rather than written into the copy,
 * so a superadmin changing the ladder changes what this page promises. A page
 * that advertises 40% while the system pays 35% is worse than no page.
 */
export default async function PartnerJoinPage() {
  const session = await getSession();
  const user = session?.user ?? null;
  if (user && (await partnerForUser(user.id))) redirect("/partner");
  const churches = user ? await getMyChurches() : [];

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
            church&rsquo;s first two months.
            {" "}
            A church that pays for a <strong>whole year up front</strong> earns
            you that year&rsquo;s commission in one go, the day it clears —
            nothing waits for them to pay again.
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

      <p className="text-muted-foreground text-sm">
        The full programme — every rate, the levels, how withdrawals are
        approved and the terms you are agreeing to — is published at{" "}
        <Link href="/partners" className="text-primary font-semibold underline">
          flockinsight.com/partners
        </Link>
        . Worth a read before you apply.
      </p>

      {user ? (
        <PartnerJoin
          defaultName={user.name ?? ""}
          email={user.email ?? ""}
          churchNames={churches.map((c) => c.name)}
        />
      ) : (
        <PartnerSignup />
      )}
    </div>
  );
}
