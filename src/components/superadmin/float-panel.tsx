"use client";

import { useState, useTransition } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RotateCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BurnChart, type BurnPoint } from "@/components/superadmin/growth-chart";

export type FloatView = {
  configured: boolean;
  balance: number | null;
  currency: string;
  fetchedAt: string | null;
  stale: boolean;
  consecutiveFailures: number;
  dailyBurn: number | null;
  runwayDays: number | null;
  coverage: number | null;
  liabilityPages: number;
  liabilityValue: number;
  unitCost: number | null;
  unitCostMode: "manual" | "auto";
  unitCostIsEstimated: boolean;
  smsPrice: number;
  pagesMonth: number;
  marginMonth: number | null;
  marginAllTime: number | null;
  thresholds: { warn: number; critical: number };
  history: BurnPoint[];
};

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-xl font-extrabold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

export function FloatPanel({
  float,
  refresh,
  saveUnitCost,
}: {
  float: FloatView;
  refresh: () => Promise<void>;
  saveUnitCost: (
    value: string,
    mode: "manual" | "auto",
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [cost, setCost] = useState(
    float.unitCost !== null ? String(float.unitCost) : "",
  );
  const [mode, setMode] = useState<"manual" | "auto">(float.unitCostMode);

  const runwayTone =
    float.runwayDays === null
      ? undefined
      : float.runwayDays < float.thresholds.critical
        ? "bad"
        : float.runwayDays < float.thresholds.warn
          ? "warn"
          : "good";

  const coverageTone =
    float.coverage === null
      ? undefined
      : float.coverage < 1
        ? "bad"
        : float.coverage < 1.5
          ? "warn"
          : "good";

  // A date is concrete in a way "12 days" is not.
  const dryDate =
    float.runwayDays !== null
      ? format(new Date(Date.now() + float.runwayDays * 86_400_000), "EEE d MMM")
      : null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="text-primary size-5" />
          Termii master wallet
        </CardTitle>
        <div className="flex items-center gap-2">
          <a
            href="https://accounts.termii.com/billing"
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
          >
            Fund <ExternalLink className="size-3.5" />
          </a>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await refresh();
                toast.success("Balance refreshed");
              })
            }
          >
            {pending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {!float.configured ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="font-semibold">Termii is not configured</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Set <code className="font-mono">TERMII_API_KEY</code> on the server
              to track the master wallet.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <p className="text-4xl font-extrabold tabular-nums">
                {float.balance === null
                  ? "—"
                  : formatMoney(float.balance, float.currency)}
              </p>
              {float.stale ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5" />
                  {float.fetchedAt
                    ? `Last read ${formatDistanceToNowStrict(new Date(float.fetchedAt), { addSuffix: true })}`
                    : "Never read"}
                </span>
              ) : (
                <span className="text-success inline-flex items-center gap-1 text-xs font-bold">
                  <CheckCircle2 className="size-3.5" />
                  Live
                </span>
              )}
            </div>

            {float.consecutiveFailures >= 3 && (
              <p className="text-destructive text-sm font-semibold">
                Termii has not answered for {float.consecutiveFailures} checks in
                a row — SMS may be failing.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Runway"
                value={
                  float.runwayDays === null
                    ? "Unknown"
                    : `${Math.round(float.runwayDays)} days`
                }
                sub={dryDate ? `Dry ${dryDate}` : "Needs more readings"}
                tone={runwayTone}
              />
              <Stat
                label="Coverage"
                value={
                  float.coverage === null
                    ? "Set unit cost"
                    : float.coverage === Infinity
                      ? "No liability"
                      : `${Math.round(float.coverage * 100)}%`
                }
                sub={
                  float.liabilityPages > 0
                    ? `${float.liabilityPages.toLocaleString()} pages owed`
                    : "Nothing owed"
                }
                tone={coverageTone}
              />
              <Stat
                label="Daily burn"
                value={
                  float.dailyBurn === null
                    ? "Unknown"
                    : formatMoney(float.dailyBurn, float.currency)
                }
                sub="7-day average"
              />
              <Stat
                label="Margin this month"
                value={
                  float.marginMonth === null
                    ? "—"
                    : formatMoney(float.marginMonth, "NGN")
                }
                sub={`${float.pagesMonth.toLocaleString()} pages sold`}
                tone={
                  float.marginMonth !== null && float.marginMonth < 0
                    ? "bad"
                    : undefined
                }
              />
            </div>

            {float.coverage !== null && float.coverage < 1 && (
              <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm font-semibold">
                You have sold more SMS than Termii can currently deliver. Fund
                the wallet by at least{" "}
                {formatMoney(
                  Math.max(0, float.liabilityValue - (float.balance ?? 0)),
                  float.currency,
                )}
                .
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-bold">Balance, last 30 days</p>
              <BurnChart data={float.history} />
            </div>
          </>
        )}

        {/* Unit cost drives coverage and margin, so it gets a control here. */}
        <div className="space-y-3 border-t pt-4">
          <div>
            <p className="text-sm font-bold">Termii cost per SMS page</p>
            <p className="text-muted-foreground text-xs">
              You sell at {formatMoney(float.smsPrice, "NGN")} per page. This is
              what it costs you, and it drives coverage and margin.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Label htmlFor="unit-cost" className="text-xs">
                Cost per page
              </Label>
              <Input
                id="unit-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="3.50"
                disabled={mode === "auto"}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {(["manual", "auto"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-bold transition",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {m === "manual" ? "Manual" : "Auto-derive"}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={saving}
              onClick={() =>
                startSave(async () => {
                  const res = await saveUnitCost(cost, mode);
                  if (res.ok) toast.success("Saved");
                  else toast.error(res.error ?? "Could not save");
                })
              }
            >
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
          {mode === "auto" && (
            <p className="text-muted-foreground text-xs">
              Auto-derive divides observed balance drawdown by pages sent. It
              needs about a week of readings; until then the manual value is
              used.
              {float.unitCostIsEstimated && float.unitCost !== null && (
                <> Currently estimating {formatMoney(float.unitCost, "NGN")}.</>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
