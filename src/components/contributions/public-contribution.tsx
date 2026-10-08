"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  Clock,
  Copy,
  Gift,
  MessageCircle,
  PartyPopper,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import type { PublicContribution } from "@/lib/contributions";
import {
  dueLabel,
  METHOD_LABEL,
  nameKey,
  PAYOUT_KIND_LABEL,
  peopleStillNeeded,
  phoneKey,
  progressPct,
  shareText,
  whatsappShareUrl,
} from "@/lib/contributions-shared";
import { shareLabels } from "@/lib/contributions-share-labels";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { SelfReportForm } from "@/components/contributions/self-report-form";
import { useT } from "@/components/i18n-provider";

/**
 * The page everybody else sees.
 *
 * This is the half of the feature that does the actual work. A church treasurer
 * does not win an argument about money by having good records; they win it by
 * everybody already being able to see the records before there is an argument.
 * So the page is built to answer, without scrolling and without being asked:
 * how much has come in, from how many people, how much has gone out, what is
 * left, and — the question everyone really opens it for — is MY payment on here.
 *
 * Four decisions worth stating.
 *
 * **Confirmed and claimed are never added together.** The big figure is money
 * the church has checked. Claims sit beside it, labelled. Adding them would make
 * the page optimistic, and an optimistic transparency page is a dishonest one.
 *
 * **Money out is shown by default.** Every comparable product shows what came
 * in and stops. "Where did our money go" is the question that splits
 * departments, and it is answered here with a list.
 *
 * **"Find my record" takes a name or a phone number**, matched with the same
 * tidying the merge screen uses, so "Sis. Grace Udo" finds "Grace Udo". The
 * search runs in the browser over rows already sent, so it is instant on a weak
 * connection and reveals nothing the page was not already showing.
 *
 * **The figures refresh themselves.** Twenty people watching a total climb on a
 * Sunday is the normal case; a number frozen at the moment the link was tapped
 * makes somebody think their payment was lost.
 */
export function PublicContributionPage({
  initial,
  /**
   * The absolute link to this page, resolved on the server.
   *
   * A required prop, and deliberately not derived from `window.location` here:
   * during the server render there is no window, so that version produced a
   * bare "/p/slug", baked it into the WhatsApp button, and anybody who tapped
   * Share before hydration sent a link that went nowhere. The server always
   * knows the real base; the browser only knows it late.
   */
  url,
}: {
  initial: PublicContribution;
  url: string;
}) {
  const t = useT();
  const pot = useLiveContribution(initial);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const due = dueLabel(pot.dueDate, new Date().toISOString().slice(0, 10));
  const overdue =
    !!pot.dueDate && pot.dueDate < new Date().toISOString().slice(0, 10);
  const pct = progressPct(pot.raised, pot.target);
  const remaining = pot.target ? Math.max(0, pot.target - pot.raised) : 0;
  const moreNeeded = peopleStillNeeded(remaining, pot.perPersonAmount);

  /** Who the search matches, and what they have given. */
  const mine = useMemo(() => {
    const q = query.trim();
    if (q.length < 2 || pot.ledger.length === 0) return null;
    const key = nameKey(q);
    const digits = phoneKey(q);
    const needle = q.toLowerCase();

    const rows = pot.ledger.filter((r) => {
      if (key && nameKey(r.name) === key) return true;
      if (digits && r.name.replace(/\D/g, "").endsWith(digits)) return true;
      return r.name.toLowerCase().includes(needle);
    });
    if (rows.length === 0) return { rows: [], confirmed: 0, pending: 0 };
    return {
      rows,
      confirmed: rows
        .filter((r) => r.status === "confirmed")
        .reduce((a, r) => a + (r.amount ?? 0), 0),
      pending: rows
        .filter((r) => r.status !== "confirmed")
        .reduce((a, r) => a + (r.amount ?? 0), 0),
    };
  }, [query, pot.ledger]);

  const visible = mine?.rows ?? pot.ledger;

  /*
   * The number printed beside each payment, and the same one the WhatsApp
   * message prints — both count down the same array from 1, so "number 4" is
   * one row whichever of the two somebody is looking at.
   *
   * Keyed by row id and taken from the WHOLE ledger, never from `visible`.
   * Numbering the filtered view instead would renumber the list as somebody
   * types in the search box, so the row they found would not be the number
   * they were told.
   */
  const lineOf = useMemo(
    () => new Map(pot.ledger.map((r, i) => [r.id, i + 1])),
    [pot.ledger],
  );

  function copyLink() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard refused — the link is on screen in the address bar, and a
        // false "copied" would be worse than saying nothing.
        setCopied(false);
      });
  }

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        {/* ---------- Church ---------- */}
        <div className="mb-5 flex items-center gap-3">
          {pot.churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pot.churchLogo}
              alt=""
              className="size-11 shrink-0 rounded-xl border object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-bold">{pot.churchName}</p>
            {pot.groupName && (
              <p className="text-muted-foreground truncate text-sm">{pot.groupName}</p>
            )}
          </div>
        </div>

        {/* ---------- The headline ---------- */}
        <div className="bg-card border-t-primary rounded-2xl border border-t-4 p-5 sm:p-6">
          {pot.kind === "gift" && pot.honoureeName && (
            <Badge variant="secondary" className="mb-2 gap-1">
              <Gift aria-hidden />{" "}
              {t("contributions.forHonouree", { name: pot.honoureeName })}
            </Badge>
          )}
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {pot.title}
          </h1>
          {pot.purpose && (
            <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap sm:text-base">
              {pot.purpose}
            </p>
          )}

          {pot.goalReached && (
            <div className="bg-success/10 text-success mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold">
              <PartyPopper className="size-4" aria-hidden /> {t("contributions.publicGoalReached")}
            </div>
          )}

          {/* The figure */}
          <div className="mt-5">
            <p className="text-3xl font-extrabold tabular-nums sm:text-4xl">
              {formatMoney(pot.raised, pot.currency)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {pot.target ? (
                <>
                  of {formatMoney(pot.target, pot.currency)} ·{" "}
                  <Users className="inline size-3.5" aria-hidden /> {t("contributions.publicGivenBy", { count: pot.givers })}
                </>
              ) : (
                <>
                  <Users className="inline size-3.5" aria-hidden /> {t("contributions.publicGivenBy", { count: pot.givers })}
                </>
              )}
            </p>

            <div
              className="bg-muted relative mt-3 h-3.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={pct ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("contributions.progressLabel")}
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700",
                  pot.goalReached ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${pct ?? (pot.raised > 0 ? 100 : 0)}%` }}
              />
              {pot.target && pot.pendingIn > 0 && (
                <div
                  className="bg-primary/30 absolute inset-y-0 rounded-full transition-[width] duration-700"
                  style={{
                    left: `${pct ?? 0}%`,
                    width: `${Math.max(0, Math.min(100 - (pct ?? 0), Math.round((pot.pendingIn / pot.target) * 100)))}%`,
                  }}
                />
              )}
            </div>

            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
              {pct !== null && <span className="font-bold tabular-nums">{pct}%</span>}
              {remaining > 0 && (
                <span>
                  {t("contributions.toGo", {
                    amount: formatMoney(remaining, pot.currency),
                  })}
                  {moreNeeded
                    ? ` — ${t("contributions.aboutPeopleAt", {
                        count: moreNeeded,
                        amount: formatMoneyCompact(
                          pot.perPersonAmount ?? 0,
                          pot.currency,
                        ),
                      })}`
                    : ""}
                </span>
              )}
              {pot.pendingIn > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  {formatMoneyCompact(pot.pendingIn, pot.currency)} {t("contributions.publicAwaitingNote")}
                </span>
              )}
              {due && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    overdue && "text-destructive font-semibold",
                  )}
                >
                  <CalendarClock className="size-3" aria-hidden /> {due}
                </span>
              )}
            </div>
          </div>

          {pot.status === "closed" && (
            <p className="bg-muted mt-4 rounded-xl px-3 py-2 text-sm font-medium">
              {t("contributions.publicClosed")}
            </p>
          )}
          {pot.status === "settled" && (
            <p className="bg-success/10 text-success mt-4 rounded-xl px-3 py-2 text-sm font-semibold">
              {t("contributions.publicSettled")}
            </p>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2">
            {pot.allowSelfReport && (
              <Button size="lg" onClick={() => setShowForm((s) => !s)}>
                <Check className="size-4" aria-hidden /> {t("contributions.publicIHavePaid")}
              </Button>
            )}
            <Button asChild variant="outline" size="lg">
              {/*
                The whole update, not a link.

                This button is pressed by somebody who already opened the link
                and is passing it on to the group — a brother who was asked
                "how far with the levy?" So the thing he forwards should
                answer it, not ask the next person to tap through too. It is
                the same text the church's own share tab composes, from the
                same data this page is drawn from, so nothing he forwards can
                say more than what he can see.
              */}
              <a
                href={whatsappShareUrl(
                  shareText(
                    {
                      title: pot.title,
                      churchName: pot.churchName,
                      groupName: pot.groupName,
                      purpose: pot.purpose,
                      honoureeName: pot.honoureeName,
                      status: pot.status,
                      currency: pot.currency,
                      raised: pot.raised,
                      target: pot.target,
                      paidOut: pot.paidOut,
                      balance: pot.balance,
                      givers: pot.givers,
                      people: pot.people,
                      goalReached: pot.goalReached,
                      dueLabel: due,
                      payInstructions: pot.payInstructions,
                      allowSelfReport: pot.allowSelfReport,
                      showPayouts: pot.showPayouts,
                      showOutstanding: pot.showOutstanding,
                      ledger: pot.ledger,
                      stillToGive: pot.stillToGive,
                      payouts: pot.payouts,
                      url,
                    },
                    shareLabels(t),
                  ),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="size-4" aria-hidden /> {t("common.share")}
              </a>
            </Button>
            <Button variant="ghost" size="lg" onClick={copyLink}>
              <Copy className="size-4" aria-hidden />{" "}
              {copied ? t("common.copied") : t("common.copyLink")}
            </Button>
          </div>
        </div>

        {/* ---------- The self-report form ---------- */}
        {showForm && pot.allowSelfReport && (
          <div className="mt-4">
            <SelfReportForm
              slug={pot.slug}
              currency={pot.currency}
              today={new Date().toISOString().slice(0, 10)}
              askForProof={pot.askForProof}
              canAskToHide={
                pot.visibility === "detailed" && !pot.allNamesHidden
              }
            />
          </div>
        )}

        {/* ---------- How to pay ---------- */}
        {pot.payInstructions && (
          <div className="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-bold">
              <Wallet className="text-primary size-4" aria-hidden /> {t("contributions.publicHowToPay")}
            </h2>
            <p className="mt-2 text-sm whitespace-pre-wrap">{pot.payInstructions}</p>
          </div>
        )}

        {/* ---------- In, out, left ---------- */}
        <div className="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
          {/*
            A list on a phone, three columns from 640px up.

            Three equal columns inside a 320px screen leaves 96px each, and
            "₦1,250,000.00" does not fit in 96px — it wraps mid-figure or pushes
            the card wider than the viewport. The label-left / figure-right rows
            give each amount the full width instead, which is also how a bank
            statement reads. (Caught by scripts/audit-mobile.mjs, which measures
            exactly this.)
          */}
          <dl className="divide-y sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:text-center">
            <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 sm:block sm:py-0">
              <dt className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold uppercase sm:justify-center">
                <ArrowDownRight className="size-3" aria-hidden />{" "}
                {t("contributions.publicIn")}
              </dt>
              <dd className="text-success text-lg font-extrabold tabular-nums sm:mt-0.5 sm:text-xl">
                {formatMoney(pot.raised, pot.currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2 sm:block sm:py-0">
              <dt className="text-muted-foreground flex items-center gap-1 text-[11px] font-bold uppercase sm:justify-center">
                <ArrowUpRight className="size-3" aria-hidden />{" "}
                {t("contributions.publicOut")}
              </dt>
              <dd className="text-lg font-extrabold tabular-nums sm:mt-0.5 sm:text-xl">
                {formatMoney(pot.paidOut, pot.currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-2 last:pb-0 sm:block sm:py-0">
              <dt className="text-muted-foreground text-[11px] font-bold uppercase">
                {t("contributions.publicRemaining")}
              </dt>
              <dd className="text-lg font-extrabold tabular-nums sm:mt-0.5 sm:text-xl">
                {formatMoney(pot.balance, pot.currency)}
              </dd>
            </div>
          </dl>

          {pot.showPayouts && pot.payouts.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-bold">{t("contributions.publicWhereItWent")}</h3>
              <ul className="mt-2 divide-y">
                {pot.payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.label}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {[PAYOUT_KIND_LABEL[p.kind], p.payee, p.paidOn]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.status !== "approved" && (
                        <Badge variant="warning">
                          {t("contributions.awaitingApproval")}
                        </Badge>
                      )}
                      <span className="text-sm font-bold tabular-nums">
                        {formatMoney(p.amount, pot.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ---------- The ledger ---------- */}
        {pot.visibility === "detailed" ? (
          <div className="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">
                {t("contributions.whoHasGiven")}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {t("contributions.payments", { count: pot.ledger.length })}
                </span>
              </h2>
            </div>

            {/*
              No search box when there are no names to search.

              A list where every row reads "Anonymous" would return nothing for
              every name typed into it, which reads as "my payment is missing"
              — the single worst thing this page can say to somebody who has
              paid. One sentence that explains why is the honest answer, and it
              names who to ask instead.
            */}
            {pot.allNamesHidden ? (
              <p className="bg-muted/40 text-muted-foreground mt-3 rounded-xl border p-3 text-sm leading-relaxed">
                {t("contributions.publicNamesHidden")}
              </p>
            ) : (
              <div className="relative mt-3">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("contributions.findYourName")}
                  aria-label={t("contributions.publicFindMeHint")}
                  className="pl-9"
                  autoComplete="name"
                />
              </div>
            )}

            {mine && mine.rows.length > 0 && (
              <div className="bg-primary/5 border-primary/20 mt-3 rounded-xl border p-3">
                <p className="text-sm font-bold">
                  {t("contributions.confirmedAmount", {
                    amount: formatMoney(mine.confirmed, pot.currency),
                  })}
                  {mine.pending > 0 && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {formatMoney(mine.pending, pot.currency)}{" "}
                      {t("contributions.publicAwaitingNote")}
                    </span>
                  )}
                </p>
                {pot.perPersonAmount != null &&
                  pot.perPersonAmount > mine.confirmed && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("contributions.stillToGoShort", {
                        amount: formatMoney(
                          pot.perPersonAmount - mine.confirmed,
                          pot.currency,
                        ),
                      })}
                    </p>
                  )}
              </div>
            )}
            {mine && mine.rows.length === 0 && (
              <p className="text-muted-foreground mt-3 text-sm">{t("contributions.publicFindMeNone")}</p>
            )}

            {visible.length === 0 ? (
              <p className="text-muted-foreground mt-4 py-6 text-center text-sm">
                {t("contributions.publicNothingYet")}
              </p>
            ) : (
              <div className="mt-3">
                <ScrollableTable
                  label={t("contributions.title")}
                  hint={t("common.scrollForMore")}
                >
                  <table className="w-full min-w-[22rem] text-sm">
                    <thead className="text-muted-foreground text-xs uppercase">
                      <tr className="border-b">
                        <th className="py-2 pr-3 text-left font-bold">
                          {t("common.name")}
                        </th>
                        <th className="px-2 py-2 text-right font-bold">
                          {t("common.amount")}
                        </th>
                        <th className="px-2 py-2 text-left font-bold">
                          {t("contributions.colWhen")}
                        </th>
                        <th className="py-2 pl-2 text-left font-bold">
                          {t("common.status")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-3">
                            {/*
                              Inline rather than a fifth column: the table is
                              already four columns inside 288px of content on
                              the narrowest phone, and a column of its own
                              would push the status badge out of reach.
                            */}
                            <span className="text-muted-foreground mr-1.5 text-xs tabular-nums">
                              {lineOf.get(r.id)}.
                            </span>
                            <span
                              className={cn(
                                "font-medium",
                                r.anonymous && "text-muted-foreground italic",
                              )}
                            >
                              {r.name}
                            </span>
                            {r.note && (
                              <span className="text-muted-foreground block text-xs">
                                &ldquo;{r.note}&rdquo;
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right font-bold tabular-nums">
                            {r.amount !== null
                              ? formatMoney(r.amount, pot.currency)
                              : "—"}
                          </td>
                          <td className="text-muted-foreground px-2 py-2.5 whitespace-nowrap">
                            {r.paidOn}
                            {r.method && (
                              <span className="block text-xs">
                                {METHOD_LABEL[r.method]}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pl-2">
                            {r.status === "confirmed" ? (
                              <Badge variant="success" className="gap-1">
                                <Check aria-hidden /> {t("contributions.confirmed")}
                              </Badge>
                            ) : r.status === "disputed" ? (
                              <Badge variant="destructive">
                                {t("contributions.beingChecked")}
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="gap-1">
                                <Clock aria-hidden /> {t("contributions.awaitingShort")}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableTable>
              </div>
            )}
          </div>
        ) : (
          <p className="bg-card text-muted-foreground mt-4 rounded-2xl border p-5 text-center text-sm">
            {t("contributions.publicNoLedger")}
          </p>
        )}

        {/* ---------- Still to give ---------- */}
        {pot.showOutstanding && pot.stillToGive.length > 0 && (
          <div className="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
            <h2 className="font-bold">{t("contributions.publicStillToGive")}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {pot.stillToGive.map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <Badge variant="outline" className="font-medium">
                    <span className="text-muted-foreground tabular-nums">
                      {i + 1}.
                    </span>{" "}
                    {s.name} · {formatMoneyCompact(s.outstanding, pot.currency)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- Footer ---------- */}
        <div className="text-muted-foreground mt-8 text-center text-xs">
          {pot.churchHandle ? (
            <a href={`/c/${pot.churchHandle}`} className="hover:underline">
              {pot.churchName}
            </a>
          ) : (
            pot.churchName
          )}
          <span aria-hidden> · </span>
          {t("contributions.publicPoweredBy")}
        </div>
      </div>
    </div>
  );
}

/**
 * Keep the figures current, without a reload.
 *
 * Polled rather than streamed: this page is opened from a WhatsApp in-app
 * browser on a phone that may be on 3G, and a long-lived connection there is
 * dropped, retried and expensive. A fetch every twenty seconds, paused while the
 * tab is hidden and repeated the moment it comes back, is cheap and survives a
 * tunnel.
 *
 * A failed poll is deliberately silent — it keeps the last good figures and
 * tries again. That is the one case where showing nothing is right: a transient
 * network error is not news, and an error banner over a working page would be.
 */
function useLiveContribution(initial: PublicContribution): PublicContribution {
  /*
   * Only the POLLED value is state; the server's render is the baseline.
   *
   * Written this way rather than seeding state from the prop and resyncing it in
   * an effect, because that effect fires on every server render and schedules a
   * second render to do what the first could have done. Comparing the prop
   * during render is React's own answer to "reset state when a prop changes",
   * and here it also expresses the right precedence: a fresh server render — the
   * one that follows somebody recording their own payment — must supersede
   * anything a poll had in hand.
   */
  const [polled, setPolled] = useState<PublicContribution | null>(null);
  const [baseline, setBaseline] = useState(initial);
  if (baseline !== initial) {
    setBaseline(initial);
    setPolled(null);
  }
  const pot = polled ?? initial;

  useEffect(() => {
    let active = true;

    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/p/${initial.slug}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as PublicContribution;
        if (active && next?.id) setPolled(next);
      } catch {
        /* transient — keep what is on screen and try again next tick */
      }
    }

    const timer = window.setInterval(poll, 20_000);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [initial.slug]);

  return pot;
}
