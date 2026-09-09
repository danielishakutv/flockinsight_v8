"use client";

import { useState } from "react";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ReferredRow = {
  id: string;
  name: string;
  joinedAt: string | null;
  subscribed: boolean;
  rewarded: boolean;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ReferralPanel({
  link,
  currency,
  rewards,
  summary,
  churches,
}: {
  link: string;
  currency: string;
  rewards: { referrer: number; referred: number };
  summary: { total: number; subscribed: number; pending: number; earned: number };
  churches: ReferredRow[];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  }

  async function share() {
    // The native sheet is how this actually gets sent on a phone: straight
    // into WhatsApp, where pastors already talk to each other.
    const nav = navigator as Navigator & {
      share?: (d: { title: string; text: string; url: string }) => Promise<void>;
    };
    if (!nav.share) return copy();
    try {
      await nav.share({
        title: "FlockInsight",
        text: "This is what we use to run our church — attendance, members, giving and more. Worth a look.",
        url: link,
      });
    } catch {
      /* the person dismissed the sheet */
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="text-primary size-5" /> Your referral link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Share this with another church. When they join and subscribe, we
            add{" "}
            <span className="text-foreground font-bold">
              {formatMoney(rewards.referrer, currency)}
            </span>{" "}
            to your wallet — and{" "}
            <span className="text-foreground font-bold">
              {formatMoney(rewards.referred, currency)}
            </span>{" "}
            to theirs as a welcome.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="bg-muted min-w-0 flex-1 truncate rounded-lg border px-3 py-2.5 font-mono text-sm">
              {link}
            </code>
            <div className="flex gap-2">
              <Button onClick={copy} variant="outline" className="shrink-0">
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={share} className="shrink-0">
                <Share2 className="size-4" /> Share
              </Button>
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            It is already on every PDF you produce — the small
            &ldquo;Prepared with FlockInsight&rdquo; line at the foot of a
            report links here. So a statement you hand round a board meeting
            counts too.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Churches referred", value: String(summary.total) },
          { label: "Subscribed", value: String(summary.subscribed) },
          { label: "Yet to subscribe", value: String(summary.pending) },
          { label: "Earned", value: formatMoney(summary.earned, currency) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent>
              <p className="text-2xl font-extrabold">{s.value}</p>
              <p className="text-muted-foreground mt-0.5 text-xs font-semibold">
                {s.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Churches you referred</CardTitle>
        </CardHeader>
        <CardContent>
          {churches.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-bold">Nobody yet</p>
              <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
                Send your link to a pastor who is still counting attendance in a
                notebook. Most churches here arrived because another church
                told them about it.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {churches.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="text-muted-foreground text-xs">
                      Joined {fmt(c.joinedAt)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
                      c.rewarded
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : c.subscribed
                          ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {c.rewarded
                      ? `Paid ${formatMoney(rewards.referrer, currency)}`
                      : c.subscribed
                        ? "Subscribed"
                        : "Trying it out"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How it works</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {[
              "Share your link. Anyone who opens it is remembered for 30 days, so they can read the site properly before signing up.",
              "They create their church. It is recorded against you the moment they do.",
              `When they subscribe to a paid plan, ${formatMoney(rewards.referrer, currency)} lands in your wallet and ${formatMoney(rewards.referred, currency)} in theirs.`,
              "Spend it on SMS, storage, or anything else the wallet covers. There is no cap on how many churches you refer.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-4 text-xs">
            Paid once per church, when they first subscribe — not for signing
            up. A church that only ever uses the free plan earns nothing, which
            is what keeps the scheme honest.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
