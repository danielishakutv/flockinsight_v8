"use client";

import { useState, useTransition } from "react";
import { HandCoins, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { startGift } from "@/app/give/[slug]/actions";
import type { PublicLink } from "@/lib/online-giving";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/brand";
import { useT } from "@/components/i18n-provider";

/**
 * The page a giver sees.
 *
 * Written for one situation: somebody on a phone, on church wifi or mobile
 * data, who has been handed a link and wants this over in under a minute. So:
 *
 *  - The amount is the first thing, large, with the preset buttons as the
 *    fast path. Everything else is one screen below it.
 *  - Three fields at most, and only one of them is required. An email address
 *    is required because the gateway sends its own receipt there, and that is
 *    said rather than merely marked with an asterisk.
 *  - It says where the money goes — to the church's own account — because a
 *    page asking for card details on a domain nobody recognises has to earn
 *    that in the first paragraph.
 *  - A closed collection says so and offers nothing. A form that cannot work
 *    is worse than no form.
 */
export function GivePage({ link }: { link: PublicLink }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState<string>(
    link.amountMode === "fixed" && link.fixedAmount ? String(link.fixedAmount) : "",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const value = Number((amount || "").replace(/[^\d.]/g, ""));
  const belowMin = !!link.minAmount && value > 0 && value < link.minAmount;
  const canSubmit =
    !pending && !belowMin && (link.amountMode === "fixed" || value > 0) && !!email.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await startGift({
        slug: link.slug,
        amount: value || 0,
        name: name.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      /*
       * A full page navigation, not a router push: the checkout is the
       * gateway's own site. Replace rather than assign, so Back from the
       * gateway returns to the giving page instead of re-submitting.
       */
      window.location.href = res.checkoutUrl;
    });
  }

  const pct =
    link.targetAmount && link.targetAmount > 0
      ? Math.min(100, Math.round((link.raised / link.targetAmount) * 100))
      : null;

  return (
    <div className="bg-muted/30 min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        {/* Who is asking. The church's own name and logo, never ours. */}
        <div className="text-center">
          {link.churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={link.churchLogo}
              alt=""
              className="mx-auto size-16 rounded-2xl object-cover"
            />
          ) : (
            <span className="bg-primary/10 text-primary mx-auto grid size-16 place-items-center rounded-2xl">
              <HandCoins className="size-7" />
            </span>
          )}
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            {link.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{link.churchName}</p>
          {link.description && (
            <p className="mt-2 text-sm leading-relaxed">{link.description}</p>
          )}
        </div>

        {link.showProgress && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-extrabold">
                    {formatMoney(link.raised, link.currency)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    from {link.givers} {link.givers === 1 ? "gift" : "gifts"}
                    {link.targetAmount
                      ? ` · goal ${formatMoney(link.targetAmount, link.currency)}`
                      : ""}
                  </p>
                </div>
                {pct !== null && <p className="text-primary font-bold">{pct}%</p>}
              </div>
              {pct !== null && (
                <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
                  <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {link.closedReason ? (
          <Card>
            <CardContent className="py-6 text-center">
              <p className="font-semibold">{link.closedReason}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("give.speakToChurch")}
              </p>
            </CardContent>
          </Card>
        ) : link.externalUrl ? (
          /*
           * The church collects on its own page. We are a signpost: no amount,
           * no form, and nothing claimed about what happens next, because we
           * are never told.
           */
          <Card>
            <CardContent className="space-y-3 py-6 text-center">
              <p className="text-sm">
                {t("give.ownPage", { church: link.churchName })}
              </p>
              <Button asChild size="lg" className="w-full">
                <a href={link.externalUrl} rel="noreferrer noopener">
                  {t("give.continueToGive")}
                </a>
              </Button>
              <p className="text-muted-foreground text-xs">
                {t("give.ownPageNote")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-5">
              <form onSubmit={submit} className="space-y-4">
                {link.amountMode === "fixed" ? (
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs font-semibold uppercase">
                      {t("give.amount")}
                    </p>
                    <p className="text-3xl font-extrabold">
                      {formatMoney(link.fixedAmount ?? 0, link.currency)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="amt">{t("give.howMuch")}</Label>
                    {link.amountMode === "preset" &&
                      link.presetAmounts.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {link.presetAmounts.map((a) => (
                            <button
                              key={a}
                              type="button"
                              onClick={() => setAmount(String(a))}
                              className={cn(
                                "rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                                value === a
                                  ? "bg-primary text-primary-foreground border-transparent"
                                  : "hover:bg-muted",
                              )}
                            >
                              {formatMoney(a, link.currency)}
                            </button>
                          ))}
                        </div>
                      )}
                    <Input
                      id="amt"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={`Amount in ${link.currency}`}
                      className="h-14 text-center text-2xl font-bold"
                      required
                    />
                    {belowMin && link.minAmount && (
                      <p className="text-destructive text-xs">
                        {t("give.smallestGift", {
                          amount: formatMoney(link.minAmount, link.currency),
                        })}
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="g-email">{t("give.yourEmail")}</Label>
                  <Input
                    id="g-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("give.emailPlaceholder")}
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("give.receiptGoesHere")}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="g-name">
                    {t("give.yourName")}{" "}
                    {link.allowAnonymous && (
                      <span className="text-muted-foreground font-normal">
                        {t("give.optionalAnonymous")}
                      </span>
                    )}
                  </Label>
                  <Input
                    id="g-name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      link.allowAnonymous
                        ? t("give.anonymous")
                        : t("give.yourFullName")
                    }
                    required={!link.allowAnonymous}
                  />
                </div>

                {link.askPhone && (
                  <div className="space-y-2">
                    <Label htmlFor="g-phone">
                      {t("give.phoneNumber")}{" "}
                      <span className="text-muted-foreground font-normal">
                        {t("give.optional")}
                      </span>
                    </Label>
                    <Input
                      id="g-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="08012345678"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("give.phoneHelps")}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="g-note">
                    {t("give.anythingToAdd")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("give.optional")}
                    </span>
                  </Label>
                  <Input
                    id="g-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("give.notePlaceholder")}
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={!canSubmit}
                >
                  {pending ? <Loader2 className="animate-spin" /> : <Lock />}
                  {pending
                    ? t("give.taking")
                    : link.amountMode === "fixed" && link.fixedAmount
                      ? `Give ${formatMoney(link.fixedAmount, link.currency)}`
                      : value > 0
                        ? `Give ${formatMoney(value, link.currency)}`
                        : t("give.continue")}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/*
          Said once, at the bottom, plainly. A giver's two questions are "is
          this really my church" and "who ends up with my money" — and the
          honest answer to the second is that we never touch it.
        */}
        <p className="text-muted-foreground flex items-start gap-2 px-2 text-xs leading-relaxed">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>{t("give.cardSafety", { church: link.churchName })}</span>
        </p>

        <div className="pt-2 text-center">
          <Wordmark className="justify-center text-sm opacity-60" logoClassName="size-5" />
        </div>
      </div>
    </div>
  );
}
