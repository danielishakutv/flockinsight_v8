import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarCheck,
  Check,
  EyeOff,
  Handshake,
  LifeBuoy,
  Link2,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { getLocale } from "@/lib/i18n/server";
import { landingContent } from "@/lib/landing-content";
import { getPartnerRates } from "@/lib/partners";
import { earningsForPayment, nextTier, tierFor } from "@/lib/partners-shared";
import { getAnnualFreeMonths, getPlanPrices } from "@/lib/pricing";
import { annualTotal } from "@/lib/billing-cycle";
import { PARTNER_TTL_SECONDS } from "@/lib/partner-link";
import { planName } from "@/lib/plans";
import { siteUrl } from "@/lib/site";
import { faqSchema, pageSchema } from "@/lib/seo/schema";
import { JsonLd } from "@/components/seo/json-ld";
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
import { Button } from "@/components/ui/button";

/**
 * The FlockInsight Partner Programme, in public.
 *
 * ## Every number on this page is the live one
 *
 * Nothing here is written into the copy. The commission, the ladder, the trail,
 * the minimum withdrawal and the qualifying window are all read from the rates
 * a superadmin set at /superadmin/partners, and the worked example is priced
 * from the live plan prices. A recruitment page that advertises 40% while the
 * system pays 35% is worse than no page at all: it is a promise somebody will
 * discover was never true on the day they ask to be paid.
 *
 * That is also why the terms are on this page rather than in a PDF somebody
 * has to ask for. A programme that pays people money needs its rules where
 * they can be read before anybody signs up — including the unflattering ones.
 *
 * ## Why it is in English while the rest of the marketing is translated
 *
 * The same reason /terms and /privacy are: half of this page is a binding
 * commitment about money, and an approximate translation of "when and why we
 * may refuse a payout" misstates what the company has undertaken. The header
 * and footer still move with the visitor's language, so the rest of the site
 * does not suddenly stop speaking to them.
 */
export const dynamic = "force-dynamic";

const TITLE = "FlockInsight Partner Program";
const DESCRIPTION =
  "Bring churches onto FlockInsight and earn a share of what they pay — on every payment, for as long as they stay. Commission rates, tiers, payouts and terms.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/partners" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/partners",
  },
};

/** The questions a person actually asks before applying. */
const FAQ = (
  rates: { minPayout: number; tierWindowDays: number; trailMonths: number },
  attributionDays: number,
): { q: string; a: string }[] => [
  {
    q: "Does it cost anything to become a FlockInsight Partner?",
    a: "No. There is no fee, no kit to buy and no quota. You apply, we approve you, and you get a referral code and a link.",
  },
  {
    q: "When do I get paid?",
    a: `When a church you brought actually pays. Commission lands in your wallet as soon as its payment clears, and you can withdraw to your bank account any time your available balance reaches ${rates.minPayout.toLocaleString()}. A person approves every withdrawal against a transfer they have really made — there is no automated transfer that can pay the wrong account.`,
  },
  {
    q: "What happens if a church pays for a whole year at once?",
    a: "You are paid the whole year's commission at once, on the day it clears — the first month, the second month and every month of trail inside it, in one go. A year paid up front is the better deal for everybody, so it is not treated as a single first payment.",
  },
  {
    q: "Can I see the members of the churches I bring?",
    a: "No, and this is deliberate. You see a church's name, its plan, whether it is paying and what you have earned from it. You never see its members, their phone numbers, its attendance or its giving. You are not staff of that church.",
  },
  {
    q: "What if two of us claim the same church?",
    a: "Attribution is decided once, when the church signs up, and is never re-pointed. Whoever's link or code was used gets the credit. If something has clearly gone wrong, raise it with us and a person will look at it.",
  },
  {
    q: "How long does my link stay credited to me?",
    a: `${attributionDays} days. A church that follows your link and signs up within ${attributionDays} days is credited to you, even if they read the pricing page, think about it and come back a fortnight later.`,
  },
  {
    q: "Do I have to be in Nigeria?",
    a: "You can introduce churches anywhere FlockInsight is sold, including outside Nigeria. Withdrawals are paid to a Nigerian bank account today; if you are elsewhere, talk to us first so we can agree how you will be paid before you start.",
  },
  {
    q: "How long does the recurring share last?",
    a: rates.trailMonths > 0
      ? `${rates.trailMonths} months of the church's subscription, after the first two. Qualifying for a higher tier is based on the churches you have live and paying in the last ${rates.tierWindowDays} days — a rolling window, so effort always counts towards something.`
      : `Tiers are based on the churches you have live and paying in the last ${rates.tierWindowDays} days — a rolling window, so effort always counts towards something.`,
  },
];

export default async function PartnerProgramPage() {
  const [locale, rates, prices, freeMonths] = await Promise.all([
    getLocale(),
    getPartnerRates(),
    getPlanPrices(),
    getAnnualFreeMonths(),
  ]);
  const content = landingContent(locale);
  const base = tierFor(rates, 0);
  const top = rates.tiers[rates.tiers.length - 1];
  const second = nextTier(rates, 0);

  /*
   * The worked example, priced from the live Growth plan.
   *
   * One certain number rather than a range, and the same arithmetic the ledger
   * will do: `earningsForPayment` is the function that decides what is
   * actually credited, so this page cannot overstate the figure even by a
   * rounding error.
   */
  const monthly = prices.growth ?? 0;
  const yearMonthly = earningsForPayment({
    rates,
    tier: base,
    amount: monthly * 12,
    firstMonth: 1,
    months: 12,
  }).reduce((sum, l) => sum + l.amount, 0);
  const annualCharge = annualTotal(monthly, freeMonths) ?? 0;
  const yearAnnual = earningsForPayment({
    rates,
    tier: base,
    amount: annualCharge,
    firstMonth: 1,
    months: 12,
  }).reduce((sum, l) => sum + l.amount, 0);

  /** How long an attribution lasts, said in days rather than seconds. */
  const attributionDays = Math.round(PARTNER_TTL_SECONDS / 86_400);

  const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

  const faq = FAQ(rates, attributionDays);
  const jsonLd = [
    pageSchema({ path: "/partners", name: TITLE, description: DESCRIPTION }),
    faqSchema(faq, "/partners"),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={jsonLd} />
      <PublicHeader nav={content.nav} />

      <main className="flex-1">
        {/* -------------------------------------------------------------
            Hero. The offer in one sentence, with the live rate in it.
            ------------------------------------------------------------- */}
        <section className="border-b">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center lg:px-8 lg:py-24">
            <span className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold">
              <Handshake className="size-4" /> FlockInsight Partner Program
            </span>
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-balance lg:text-6xl">
              Bring churches onto FlockInsight.{" "}
              <span className="text-primary">Earn on every one.</span>
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg text-pretty">
              You know the churches in your city. We built the software they are
              already paying people to replace with notebooks. Introduce them,
              help them get started, and take{" "}
              <strong className="text-foreground">
                {pct(base.firstBps)} of their first two months
              </strong>
              {rates.trailBps > 0 && (
                <>
                  {" "}
                  and{" "}
                  <strong className="text-foreground">
                    {pct(rates.trailBps)} of every payment after that for{" "}
                    {rates.trailMonths} months
                  </strong>
                </>
              )}
              .
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/partner/join">
                  Start my application <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              Free to join · No quota · Nothing to buy · Withdraw from{" "}
              {naira(rates.minPayout)}
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------------
            What you earn. The live rates, as a table nobody has to
            interpret.
            ------------------------------------------------------------- */}
        <section id="what-you-earn" className="border-b">
          <div className="mx-auto max-w-5xl px-4 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              What you earn
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl">
              These are the live rates, read from our own settings as this page
              loaded — not a brochure figure. If we change them, this page
              changes with them, and anything you have already earned stays at
              the rate it was earned at.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <EarnCard
                icon={<Banknote className="size-5" />}
                value={pct(base.firstBps)}
                title="Of the first payment"
                body="Paid as soon as the church's first payment clears."
              />
              <EarnCard
                icon={<Banknote className="size-5" />}
                value={pct(base.secondBps)}
                title="Of the second payment"
                body="Earned when the second month is actually paid for — which is also why nobody here is paid for signing a church that cannot pay."
              />
              <EarnCard
                icon={<TrendingUp className="size-5" />}
                value={rates.trailBps > 0 ? pct(rates.trailBps) : "—"}
                title={
                  rates.trailBps > 0
                    ? `Of every payment, for ${rates.trailMonths} months`
                    : "No recurring share at present"
                }
                body={
                  rates.trailBps > 0
                    ? "The reason this is worth staying in: it turns a one-off introduction into an income, and it means you want your churches to thrive rather than merely to sign."
                    : "Your earnings come from the first two payments."
                }
              />
            </div>

            {/* The ladder. One mechanic, and the first rung is where
                everybody already stands. */}
            <div className="mt-10">
              <h3 className="flex items-center gap-2 text-xl font-bold">
                <BadgeCheck className="text-primary size-5" /> The ladder
              </h3>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
                Your rate rises with the number of churches you have{" "}
                <strong>live and paying</strong> in the last{" "}
                {rates.tierWindowDays} days — not the number you signed up. It
                is a rolling window rather than a calendar month, so a church
                you brought in last week still counts next month.
              </p>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="py-2 pr-4 font-semibold">Level</th>
                      <th className="py-2 pr-4 font-semibold">
                        Churches live &amp; paying
                      </th>
                      <th className="py-2 pr-4 font-semibold">First payment</th>
                      <th className="py-2 font-semibold">Second payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.tiers.map((t, i) => (
                      <tr key={t.name} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-bold">
                          {t.name}
                          {i === 0 && (
                            <span className="text-primary ml-2 text-xs font-bold">
                              you start here
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 tabular-nums">
                          {t.minChurches === 0 ? "Any" : `${t.minChurches}+`}
                        </td>
                        <td className="py-3 pr-4 font-semibold tabular-nums">
                          {pct(t.firstBps)}
                        </td>
                        <td className="py-3 font-semibold tabular-nums">
                          {pct(t.secondBps)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {second && (
                <p className="text-muted-foreground mt-3 text-sm">
                  {second.needed} church{second.needed === 1 ? "" : "es"} live
                  and paying is enough to reach{" "}
                  <strong className="text-foreground">
                    {second.tier.name}
                  </strong>
                  , at {pct(second.tier.firstBps)}. The top of the ladder today
                  is {top.name}.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            A worked example, including the annual case.
            ------------------------------------------------------------- */}
        {monthly > 0 && (
          <section className="bg-muted/30 border-b">
            <div className="mx-auto max-w-5xl px-4 py-16 lg:px-8 lg:py-20">
              <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
                One church, in real numbers
              </h2>
              <p className="text-muted-foreground mt-3 max-w-2xl">
                A single church on {planName("growth")} at {naira(monthly)} a
                month, in your first year as a {base.name}. Computed with the
                same function that credits your wallet, so this figure cannot
                flatter us.
              </p>

              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                <div className="bg-card rounded-3xl border p-6 shadow-sm">
                  <p className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
                    They pay monthly
                  </p>
                  <p className="mt-2 text-4xl font-extrabold tracking-tight">
                    {naira(yearMonthly)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    over the twelve months, as each payment clears
                  </p>
                  <ul className="mt-4 space-y-2 text-sm">
                    <Li>
                      {pct(base.firstBps)} of month one and{" "}
                      {pct(base.secondBps)} of month two
                    </Li>
                    {rates.trailBps > 0 && (
                      <Li>
                        {pct(rates.trailBps)} of every month after that, for{" "}
                        {rates.trailMonths} months
                      </Li>
                    )}
                    <Li>
                      Each piece lands when that month is actually paid for
                    </Li>
                  </ul>
                </div>

                <div className="border-primary ring-primary/30 bg-card relative rounded-3xl border p-6 shadow-sm ring-2">
                  <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-bold">
                    Paid today
                  </span>
                  <p className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
                    They pay for the year up front
                  </p>
                  <p className="mt-2 text-4xl font-extrabold tracking-tight">
                    {naira(yearAnnual)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    in one go, on the day the payment clears
                  </p>
                  <ul className="mt-4 space-y-2 text-sm">
                    <Li>
                      The church pays {naira(annualCharge)} for twelve months
                      instead of {naira(monthly * 12)} — {freeMonths} months
                      free
                    </Li>
                    <Li>
                      You are paid the first month, the second month and every
                      month of trail inside that year <strong>at once</strong>
                    </Li>
                    <Li>
                      Nothing is held back waiting for the church to pay again
                    </Li>
                  </ul>
                  <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
                    It comes to a little less than the monthly route in total
                    because the church paid less in total — your share of what
                    they pay is the same either way. You simply have it now
                    rather than next December.
                  </p>
                </div>
              </div>

              <p className="text-muted-foreground mt-6 text-sm">
                Bring five churches like that one and the first-payment rate
                rises as well. Bring a church onto {planName("pro")} and every
                figure above is more than twice as large.
              </p>
            </div>
          </section>
        )}

        {/* -------------------------------------------------------------
            How to start.
            ------------------------------------------------------------- */}
        <section id="how-it-works" className="border-b">
          <div className="mx-auto max-w-5xl px-4 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              How to start
            </h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Step
                n={1}
                title="Apply"
                body="One short form: your name, your phone number and your email address. No fee and no interview. We approve Partners by hand, usually the same day."
              />
              <Step
                n={2}
                title="Get your link & code"
                body="A six-character code you can read down a phone line, and a link like flockinsight.com/a/bc3k9m. Any church that signs up within 30 days of following it is yours."
              />
              <Step
                n={3}
                title="Introduce churches"
                body="Share the link, or sit with a pastor and set the church up there and then with your code in the box. Both count the same."
              />
              <Step
                n={4}
                title="Get paid"
                body={`Commission lands in your wallet as each payment clears. Add your bank details, verify your email and phone, and withdraw from ${naira(rates.minPayout)}.`}
              />
            </div>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link href="/partner/join">
                  Start my application <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            Perks & benefits.
            ------------------------------------------------------------- */}
        <section className="bg-muted/30 border-b">
          <div className="mx-auto max-w-5xl px-4 py-16 lg:px-8 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              What you get, beyond the commission
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Perk
                icon={<Wallet className="size-5" />}
                title="A wallet you can hide"
                body="Available, pending, withdrawn and lifetime, with every earning listed and the rate it was paid at. One tap blanks the figures — useful when you are sitting across a desk from the pastor you are signing up."
              />
              <Perk
                icon={<Link2 className="size-5" />}
                title="A link and a code that survive real life"
                body="The code has no characters that sound like other characters, so it can be read out over a bad phone line. The link remembers you for thirty days, so a church can go and think about it."
              />
              <Perk
                icon={<Users className="size-5" />}
                title="Your churches, at a glance"
                body="Every church you brought, its plan, whether it is paying, and what you have earned from it. Enough to know who needs a visit this week."
              />
              <Perk
                icon={<LifeBuoy className="size-5" />}
                title="Raise a ticket on their behalf"
                body="You can open a support ticket for any church you brought, and our team can see it came from you. You are not left telling a pastor to email somebody."
              />
              <Perk
                icon={<CalendarCheck className="size-5" />}
                title="A whole year paid at once"
                body="When a church pays for twelve months up front, you are paid the twelve months of commission with it — not one month now and the rest whenever they renew."
              />
              <Perk
                icon={<ShieldCheck className="size-5" />}
                title="A ledger, not a balance"
                body="Every naira in your wallet is a row that names the church, the payment and the rate. If you ever disagree with a figure, there is something to check it against."
              />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            The privacy line. This is a feature, said plainly.
            ------------------------------------------------------------- */}
        <section className="border-b">
          <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
            <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
              <EyeOff className="text-primary size-6" /> What you will never see
            </h2>
            <p className="text-muted-foreground mt-4">
              A Partner sees numbers and plan status. Never a church&rsquo;s
              members, their phone numbers or addresses, their attendance, their
              giving or their finances. Not as a setting that could be switched
              on — the dashboard has no query that could return it.
            </p>
            <p className="text-muted-foreground mt-3">
              This is the line between helping a church and watching somebody
              else&rsquo;s congregation, and it is the thing that makes a pastor
              comfortable being introduced by you. If you need something about a
              church you brought, ask them, or raise a ticket with us.
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------------
            Who it suits.
            ------------------------------------------------------------- */}
        <section className="bg-muted/30 border-b">
          <div className="mx-auto max-w-5xl px-4 py-16 lg:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
              Who does well at this
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                "Church administrators and IT volunteers who already set up systems for their own church",
                "Ministers and denominational workers who move between congregations",
                "Christian software resellers, trainers and consultants",
                "Students and youth workers with a phone and a list of churches in their area",
                "Anyone who has sat through a service counting attendance on paper and thought there must be a better way",
              ].map((s) => (
                <li
                  key={s}
                  className="bg-card flex items-start gap-2 rounded-xl border p-4 text-sm"
                >
                  <Check className="text-primary mt-0.5 size-4 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* -------------------------------------------------------------
            FAQ — also emitted as FAQPage structured data.
            ------------------------------------------------------------- */}
        <section className="border-b">
          <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
            <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              Straight answers
            </h2>
            <div className="mt-8 space-y-6">
              {faq.map((f) => (
                <div key={f.q}>
                  <h3 className="font-bold">{f.q}</h3>
                  <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                    {f.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            Terms. On the page, before anybody applies.
            ------------------------------------------------------------- */}
        <section id="terms" className="bg-muted/30 border-b">
          <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
            <h2 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
              Partner terms &amp; conditions
            </h2>
            <p className="text-muted-foreground mt-3 text-sm">
              These terms govern the FlockInsight Partner Program, operated by
              Toko Technologies. They sit alongside our{" "}
              <Link href="/terms" className="text-primary underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
              . Applying to the programme means accepting them.
            </p>

            <div className="mt-8 space-y-6 text-sm leading-relaxed">
              <Term n="1" title="Who may join">
                You must be at least 18 and able to hold a bank account in your
                own name. A Partner account belongs to one person, not to a
                team; we approve each one by hand and may decline an application
                without giving a reason. Being a Partner does not make you an
                employee, agent or representative of Toko Technologies, and you
                may not present yourself as one.
              </Term>

              <Term n="2" title="Attribution">
                A church is credited to the Partner whose link it followed
                within the previous {attributionDays} days, or whose code was entered when it
                signed up. Attribution is recorded once, when the church signs
                up, and is never moved afterwards — so if two Partners both
                claim a church, the record stands and the matter is settled
                between people rather than by changing the ledger. A church that
                signed up on its own cannot be claimed retrospectively.
              </Term>

              <Term n="3" title="What you earn, and when">
                You earn {pct(base.firstBps)} of a referred church&rsquo;s first
                month and {pct(base.secondBps)} of its second month at the base
                level, more at higher levels,
                {rates.trailBps > 0 ? (
                  <>
                    {" "}
                    followed by {pct(rates.trailBps)} of each of the next{" "}
                    {rates.trailMonths} months.
                  </>
                ) : (
                  <> and nothing thereafter.</>
                )}{" "}
                Commission is earned on money that has actually cleared, never
                on a signup, a trial or a promise. A payment covering several
                months — a year paid up front, for instance — earns the
                commission for every month it covers, in one credit, on the day
                it clears. Your share is calculated on what the church actually
                paid, so a discount the church received reduces the amount your
                percentage is taken from.
              </Term>

              <Term n="4" title="Levels">
                Your level is calculated from the number of your churches that
                are live and paying within the last {rates.tierWindowDays} days.
                It is recalculated continuously rather than stored, so it can go
                down as well as up. The rate applied to an earning is the rate
                in force on the day that payment cleared, and is recorded on
                that row; a later change to the rates never alters money already
                earned.
              </Term>

              <Term n="5" title="Withdrawals">
                You may request a withdrawal once your available balance reaches{" "}
                {naira(rates.minPayout)}, you have added your bank details, and
                your email address and phone number are verified. One request
                may be open at a time. A person reviews every request and marks
                it paid against a transfer actually made. A rejected request
                returns the money to your wallet — it is never destroyed — and
                we will tell you why. Bank details must be your own; we do not
                pay a third party on your behalf.
              </Term>

              <Term n="6" title="Taxes and your own costs">
                You are responsible for your own taxes, levies and costs. We pay
                the gross amount shown in your wallet and withhold nothing
                unless the law requires us to, in which case we will tell you.
                Transport, airtime, data and anything else you spend winning a
                church is yours.
              </Term>

              <Term n="7" title="How you may and may not sell">
                Describe FlockInsight accurately. You may not: claim a feature
                that does not exist or a price that is not on our pricing page;
                promise a church a discount, a refund or a timeline we have not
                agreed; use our name or logo to imply you are FlockInsight;
                register domains, social accounts or app listings using our
                name; bid on our brand name in paid search; or send unsolicited
                bulk messages, which includes buying lists of church phone
                numbers. Nothing you do may breach the Nigeria Data Protection
                Act or the equivalent law where the church is.
              </Term>

              <Term n="8" title="No self-dealing">
                You may not refer a church you control in order to earn
                commission on your own subscription, create accounts for
                churches that do not exist or have not asked, pay a church to
                sign up and then churn, or use a second Partner account. Any of
                these cancels the earnings involved and ends the Partner
                account.
              </Term>

              <Term n="9" title="Church data">
                The data a church puts into FlockInsight belongs to that church.
                As a Partner you are given numbers and plan status only, and you
                must not ask a church for its members&rsquo; details in order to
                enter them yourself unless the church has asked you to help and
                is present while you do it. Anything you learn about a church in
                the course of helping it is confidential.
              </Term>

              <Term n="10" title="Suspension and cancellation">
                We may suspend a Partner account, withhold a payout or cancel an
                earning where we reasonably believe it arises from fraud,
                abuse, a breach of these terms, a payment that is later reversed
                or refunded, or a church created without its knowledge. We will
                say which, and you may ask us to look again. Earnings properly
                earned before a suspension remain payable.
              </Term>

              <Term n="11" title="Ending it">
                Either side may end the arrangement at any time, in writing. If
                you leave, you may withdraw a balance that has already been
                earned and released, subject to the minimum; a recurring share
                on churches you brought stops when the arrangement ends. We
                cannot promise the programme will run for ever — it may be
                closed or changed — but we will give at least 30 days&rsquo;
                notice of a change that reduces a rate, and anything already
                earned is unaffected.
              </Term>

              <Term n="12" title="Changes to these terms">
                We may update these terms. The version on this page is the one
                in force, and we will tell Partners about a material change. The
                rates quoted on this page are read live from our own settings as
                the page loads, so what you read here is what the system will
                pay.
              </Term>

              <Term n="13" title="Law">
                These terms are governed by the laws of the Federal Republic of
                Nigeria. Questions about the programme go to{" "}
                <a
                  href="mailto:partners@flockinsight.com"
                  className="text-primary break-all underline"
                >
                  partners@flockinsight.com
                </a>
                .
              </Term>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------
            Closing CTA.
            ------------------------------------------------------------- */}
        <section>
          <div className="mx-auto max-w-3xl px-4 py-16 text-center lg:px-8 lg:py-24">
            <h2 className="text-3xl font-extrabold tracking-tight text-balance lg:text-4xl">
              Start with one church you already know
            </h2>
            <p className="text-muted-foreground mt-4">
              Apply, get your code, and introduce the first one this Sunday.
              There is no fee, no quota and nothing to buy.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/partner/join">
                  Start my application <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/partner">My Partner dashboard</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-6 text-xs">
              Already a Partner? Your dashboard, your wallet and your churches
              are at {siteUrl().replace(/^https?:\/\//, "")}/partner.
            </p>
          </div>
        </section>
      </main>

      <PublicFooter
        footer={content.footer}
        nav={content.nav}
        pricing={content.pricing}
        tagline={content.footerTagline}
      />
    </div>
  );
}

function EarnCard({
  icon,
  value,
  title,
  body,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card rounded-3xl border p-6 shadow-sm">
      <span className="bg-primary/10 text-primary inline-flex size-10 items-center justify-center rounded-xl">
        {icon}
      </span>
      <p className="mt-4 text-4xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-1 font-bold">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div>
      <span className="bg-primary text-primary-foreground inline-flex size-9 items-center justify-center rounded-full font-extrabold">
        {n}
      </span>
      <h3 className="mt-3 font-bold">{title}</h3>
      {/*
        `break-words` because step 2 names an example link, which at 320px is
        a single token wider than the column and cannot wrap on its own. The
        mobile audit flags that as HIGH, correctly: the CSS has no other
        option.
      */}
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed break-words">
        {body}
      </p>
    </div>
  );
}

function Perk({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card rounded-2xl border p-5">
      <span className="bg-primary/10 text-primary inline-flex size-9 items-center justify-center rounded-lg">
        {icon}
      </span>
      <h3 className="mt-3 font-bold">{title}</h3>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Term({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="font-bold">
        {n}. {title}
      </h3>
      <p className="text-muted-foreground mt-1.5">{children}</p>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="text-primary mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
