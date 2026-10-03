"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  activateGatewayAction,
  saveGatewayAction,
  stopOnlineGivingAction,
} from "@/app/(app)/settings/payments/actions";
import type { ProviderId, ProviderSpec } from "@/lib/gateways/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/i18n-provider";

export type GatewayView = {
  id: string;
  provider: ProviderId;
  publicKey: string | null;
  linkUrl: string | null;
  isActive: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  secretHint: string | null;
  extraKeys: string[];
};

/**
 * Connecting a church's own payment gateway.
 *
 * Two promises this screen has to make believable, because a pastor is about
 * to paste a key that can move their money:
 *
 *  1. The money goes to THEIR account. Said at the top, in the first sentence,
 *     not in a help article.
 *  2. The keys are checked against the provider before anything is switched
 *     on. "Saved" would mean nothing here — a revoked key saves perfectly and
 *     fails on Sunday morning.
 */
export function GatewaySetup({
  gateways,
  specs,
  currency,
  canManage,
  webhookBase,
}: {
  gateways: GatewayView[];
  specs: ProviderSpec[];
  currency: string;
  canManage: boolean;
  /** e.g. https://flockinsight.com/api/pay — one URL per provider under it. */
  webhookBase: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = gateways.find((g) => g.isActive) ?? null;
  const [open, setOpen] = useState<ProviderId | null>(
    // Nothing connected yet → open the first one, so the page is a form rather
    // than a menu of things to click.
    active ? null : (specs[0]?.id ?? null),
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [hookCopied, setHookCopied] = useState(false);

  async function copyHook(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setHookCopied(true);
      setTimeout(() => setHookCopied(false), 2000);
    } catch {
      // Refused on an insecure origin or a locked-down browser. The URL is
      // on screen and selectable, so say that rather than failing silently.
      toast.error(t("give.copyFailed"));
    }
  }

  function set(key: string, v: string) {
    setValues((s) => ({ ...s, [key]: v }));
  }

  function save(spec: ProviderSpec) {
    const extra: Record<string, string> = {};
    for (const f of spec.fields) {
      if (f.key === "publicKey" || f.key === "secret" || f.key === "linkUrl") continue;
      const v = values[`${spec.id}.${f.key}`];
      if (v) extra[f.key] = v;
    }
    start(async () => {
      const res = await saveGatewayAction({
        provider: spec.id,
        publicKey: values[`${spec.id}.publicKey`] ?? "",
        secret: values[`${spec.id}.secret`] ?? "",
        linkUrl: values[`${spec.id}.linkUrl`] ?? "",
        extra,
        activate: true,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.detail ?? "Connected.");
      setValues({});
      setOpen(null);
      router.refresh();
    });
  }

  function activate(provider: ProviderId) {
    start(async () => {
      const res = await activateGatewayAction(provider);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.detail ?? "Switched.");
      router.refresh();
    });
  }

  function stop() {
    if (
      !confirm(
        "Turn off online giving? Your keys are kept, and your giving links will say the collection isn't taking gifts.",
      )
    )
      return;
    start(async () => {
      const res = await stopOnlineGivingAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("give.givingOff"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="text-primary size-5" /> How you collect online
        </CardTitle>
        <CardDescription>
          Connect your church&apos;s own payment account. Gifts go straight into
          it, on its own settlement schedule — FlockInsight never holds your
          money and takes no cut of it. Your keys are encrypted before they are
          stored, and we never show them back to you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
            <BadgeCheck className="size-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Collecting through{" "}
                {specs.find((s) => s.id === active.provider)?.name ?? active.provider}
              </p>
              <p className="text-muted-foreground text-xs">
                {active.verifiedAt
                  ? `Keys last checked ${new Date(active.verifiedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
                  : "Not checked yet"}
                {active.secretHint ? ` · secret ${active.secretHint}` : ""}
              </p>
            </div>
            {canManage && (
              <Button variant="outline" size="sm" onClick={stop} disabled={pending}>
                Turn off
              </Button>
            )}
          </div>
        )}

        {specs.map((spec) => {
          const stored = gateways.find((g) => g.provider === spec.id);
          const isOpen = open === spec.id;
          return (
            <div
              key={spec.id}
              className={cn(
                "rounded-xl border p-3",
                stored?.isActive && "border-emerald-500/40",
              )}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {spec.name}
                    {stored?.isActive && (
                      <Badge variant="success">{t("give.inUse")}</Badge>
                    )}
                    {stored && !stored.isActive && (
                      <Badge variant="secondary">{t("give.saved")}</Badge>
                    )}
                    {!spec.reportsBack && (
                      <Badge variant="outline">{t("give.noRecordsBack")}</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-sm">{spec.blurb}</p>
                  {spec.currencies.length > 0 &&
                    !spec.currencies.includes(currency.toUpperCase()) && (
                      <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <CircleAlert className="mr-1 inline size-3.5" />
                        Can&apos;t charge in {currency} — it handles{" "}
                        {spec.currencies.join(", ")}.
                      </p>
                    )}
                  {/*
                    The provider's own words when it refused. Shown rather than
                    swallowed: "Invalid key" from Paystack is actionable, and
                    "something went wrong" is not.
                  */}
                  {stored?.lastError && (
                    <p className="text-destructive mt-1 text-xs">{stored.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {canManage && stored && !stored.isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => activate(spec.id)}
                      disabled={pending}
                    >
                      Use this
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant={isOpen ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setOpen(isOpen ? null : spec.id)}
                      disabled={pending}
                    >
                      {stored ? "Update keys" : "Connect"}
                    </Button>
                  )}
                </div>
              </div>

              {isOpen && canManage && (
                <form
                  className="mt-3 space-y-3 border-t pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(spec);
                  }}
                >
                  {spec.dashboardUrl && (
                    <a
                      href={spec.dashboardUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary inline-flex items-center gap-1 text-xs font-semibold"
                    >
                      Where to find these in {spec.name}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {spec.fields.map((f) => {
                    const id = `${spec.id}.${f.key}`;
                    const alreadyStored =
                      f.key === "secret"
                        ? !!stored?.secretHint
                        : f.key === "publicKey"
                          ? !!stored?.publicKey
                          : f.key === "linkUrl"
                            ? !!stored?.linkUrl
                            : !!stored?.extraKeys.includes(f.key);
                    return (
                      <div key={f.key} className="space-y-1.5">
                        <Label htmlFor={id}>
                          {f.label}
                          {!f.required && (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              (optional)
                            </span>
                          )}
                        </Label>
                        <Input
                          id={id}
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          value={values[id] ?? ""}
                          placeholder={
                            alreadyStored && f.secret
                              ? "•••••••• (leave blank to keep)"
                              : f.placeholder
                          }
                          onChange={(e) => set(id, e.target.value)}
                        />
                        {f.hint && (
                          <p className="text-muted-foreground text-xs">{f.hint}</p>
                        )}
                      </div>
                    );
                  })}
                  {/*
                    The webhook URL, beside the keys rather than in a help
                    article. Without it a gift is only recorded when the giver's
                    browser makes it back to us — which on a Nigerian mobile
                    connection is the thing that fails. With it, the gateway
                    tells us directly and the browser is merely the faster of
                    two routes.
                  */}
                  {spec.reportsBack && (
                    <div className="bg-muted/50 space-y-1.5 rounded-xl border p-3">
                      <p className="text-sm font-semibold">
                        Also paste this into {spec.name} as your webhook URL
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="bg-background min-w-0 flex-1 truncate rounded-lg border px-2 py-1.5 text-xs">
                          {`${webhookBase}/${spec.id}`}
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyHook(`${webhookBase}/${spec.id}`)}
                        >
                          {hookCopied ? <Check /> : <Copy />}
                          {hookCopied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Gifts are recorded even without it, when the giver
                        returns to the page. With it, they are recorded the
                        moment {spec.name} confirms them — including when
                        somebody&apos;s phone loses signal on the way back.
                      </p>
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {spec.canVerify
                      ? `We'll check these against ${spec.name} before switching anything on.`
                      : "Nothing to check — we'll just show the button."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending}>
                      {pending && <Loader2 className="animate-spin" />}
                      {spec.canVerify ? "Check & connect" : "Save link"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOpen(null)}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
