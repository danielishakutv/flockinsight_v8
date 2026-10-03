"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  HardDrive,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Tag,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  setPlanPrices,
  setPlanFeaturesAction,
  resetPlanFeaturesAction,
  setStorageBundlesAction,
  setReferralRewardsAction,
  type PlanPriceInput,
} from "@/app/superadmin/pricing/actions";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";
import type { StorageBundle } from "@/lib/storage-bytes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRICED = ["starter", "growth", "pro"] as const;
const ALL_PLANS: PlanId[] = ["starter", "growth", "pro", "enterprise"];

export function PricingAdmin({
  initial,
  bundles: initialBundles,
  features,
  drift,
  referralRewards,
  referralStats,
}: {
  initial: PlanPriceInput;
  bundles: StorageBundle[];
  features: Record<PlanId, string[]>;
  /**
   * Whether each plan's live list is a saved override, and what the app would
   * say if it were not. This is the thing that was invisible.
   */
  drift: Record<PlanId, { overridden: boolean; builtIn: string[]; missing: string[] }>;
  referralRewards: { referrer: number; referred: number };
  referralStats: { referred: number; rewarded: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<PlanPriceInput>(initial);
  const [bundles, setBundles] = useState<StorageBundle[]>(initialBundles);
  const [savingBundles, startBundles] = useTransition();
  const [rw, setRw] = useState(referralRewards);
  const [savingRw, startRw] = useTransition();

  function saveRewards() {
    startRw(async () => {
      const res = await setReferralRewardsAction(rw);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Referral rewards updated");
      router.refresh();
    });
  }

  function save() {
    start(async () => {
      const res = await setPlanPrices(f);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Plan prices updated");
      router.refresh();
    });
  }

  function saveBundles() {
    const clean = bundles
      .map((b) => ({ gb: Math.round(Number(b.gb)), price: Math.round(Number(b.price)) }))
      .filter((b) => Number.isFinite(b.gb) && b.gb > 0 && Number.isFinite(b.price) && b.price >= 0);
    if (clean.length === 0) {
      toast.error("Add at least one storage bundle.");
      return;
    }
    startBundles(async () => {
      const res = await setStorageBundlesAction(clean);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Storage bundles updated");
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Referral rewards */}
      <section className="rounded-2xl border p-5">
        <h2 className="text-lg font-bold">Referral rewards</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Paid once, when a referred church makes its first successful payment
          — never at signup, so it cannot be farmed. {referralStats.referred}{" "}
          church{referralStats.referred === 1 ? "" : "es"} arrived by referral,{" "}
          {referralStats.rewarded} rewarded so far.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rw-referrer">To the referring church (₦)</Label>
            <Input
              id="rw-referrer"
              type="number"
              min={0}
              value={rw.referrer}
              onChange={(e) =>
                setRw({ ...rw, referrer: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rw-referred">Welcome credit to the new church (₦)</Label>
            <Input
              id="rw-referred"
              type="number"
              min={0}
              value={rw.referred}
              onChange={(e) =>
                setRw({ ...rw, referred: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveRewards} disabled={savingRw}>
            {savingRw && <Loader2 className="size-4 animate-spin" />}
            Save rewards
          </Button>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Setting either to 0 turns that side off. Changes apply to referrals
          rewarded from now on; bonuses already credited stay in the wallet
          ledger.
        </p>
      </section>


      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Pricing
        </h1>
        <p className="text-muted-foreground mt-1">
          Set the monthly price (₦) for each plan. Changes reflect on the
          landing page, the pricing page and every church&apos;s billing &
          checkout.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Tag className="text-primary size-5" /> Plan prices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {PRICED.map((id) => {
            const meta = PLAN_BY_ID[id];
            return (
              <div
                key={id}
                className="flex flex-wrap items-end justify-between gap-3 rounded-xl border p-3"
              >
                <div>
                  <p className="font-bold">{meta.name}</p>
                  <p className="text-muted-foreground text-xs">{meta.tagline}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`price-${id}`} className="text-xs">
                    ₦ / month
                  </Label>
                  <Input
                    id={`price-${id}`}
                    type="number"
                    min={0}
                    step="100"
                    value={f[id]}
                    onChange={(e) =>
                      setF((p) => ({ ...p, [id]: Number(e.target.value) }))
                    }
                    className="h-11 w-40 text-right font-bold tabular-nums"
                  />
                </div>
              </div>
            );
          })}
          <p className="text-muted-foreground text-xs">
            Set Starter to 0 to keep it free. Enterprise stays custom (contact
            sales) and has no fixed price.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save prices
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="text-primary size-5" /> Plan features
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-muted-foreground text-sm">
            The bullet list shown for each plan on the landing &amp; pricing
            pages. Reorder with the arrows.
          </p>
          <p className="text-muted-foreground text-sm">
            Saving a list <strong>pins it for ever</strong> — the plan stops
            following the app, so a module shipped afterwards will not appear
            here or on the website until somebody edits this page again. Any plan
            in that state says so below, and lists what it is not telling
            churches about.
          </p>
          {ALL_PLANS.map((id) => (
            <FeaturesEditor
              key={id}
              plan={id}
              initial={features[id] ?? []}
              drift={drift[id]}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="text-primary size-5" /> Storage bundles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Monthly storage add-ons churches can buy from their wallet (on top
            of the free 200MB base).
          </p>
          {bundles.map((b, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 rounded-xl border p-3"
            >
              <div className="space-y-1">
                <Label className="text-xs">Extra GB</Label>
                <Input
                  type="number"
                  min={1}
                  value={b.gb}
                  onChange={(e) =>
                    setBundles((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, gb: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  className="h-11 w-28 text-right font-bold tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">₦ / month</Label>
                <Input
                  type="number"
                  min={0}
                  step="100"
                  value={b.price}
                  onChange={(e) =>
                    setBundles((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, price: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  className="h-11 w-36 text-right font-bold tabular-nums"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-11 sm:size-10"
                onClick={() =>
                  setBundles((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label="Remove this bundle"
                title="Remove"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBundles((prev) => [...prev, { gb: 1, price: 500 }])}
          >
            <Plus className="size-4" /> Add bundle
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveBundles} disabled={savingBundles} size="lg">
          {savingBundles && <Loader2 className="size-4 animate-spin" />}
          Save storage bundles
        </Button>
      </div>
    </div>
  );
}

function FeaturesEditor({
  plan,
  initial,
  drift,
}: {
  plan: PlanId;
  initial: string[];
  drift?: { overridden: boolean; builtIn: string[]; missing: string[] };
}) {
  const router = useRouter();
  const [items, setItems] = useState<string[]>(initial);
  const [saving, start] = useTransition();
  const meta = PLAN_BY_ID[plan];

  /** Hand this plan's list back to the app, keeping its allowances. */
  function useBuiltIn() {
    start(async () => {
      const res = await resetPlanFeaturesAction(plan);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setItems(drift?.builtIn ?? []);
      toast.success(`${meta.name} now follows the app`);
      router.refresh();
    });
  }

  const edit = (i: number, v: string) =>
    setItems((p) => p.map((x, j) => (j === i ? v : x)));
  const remove = (i: number) => setItems((p) => p.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) =>
    setItems((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function save() {
    const clean = items.map((s) => s.trim()).filter(Boolean).slice(0, 30);
    start(async () => {
      const res = await setPlanFeaturesAction({ plan, features: clean });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${meta.name} features saved`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-bold">{meta.name}</p>
        {drift?.overridden && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
            Edited — not following the app
          </span>
        )}
      </div>

      {drift?.overridden && drift.missing.length > 0 && (
        /*
          The sentences churches are NOT being told, named one by one. A count
          would not have been enough to make anybody act: what makes this
          actionable is reading "Virtual meetings" in the list and realising the
          price page has never mentioned them.
        */
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <TriangleAlert className="size-3.5" />
            {drift.missing.length} thing{drift.missing.length === 1 ? "" : "s"} the app
            offers that this plan does not mention
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-800/90 dark:text-amber-300/80">
            {drift.missing.slice(0, 8).map((m) => (
              <li key={m}>• {m}</li>
            ))}
            {drift.missing.length > 8 && <li>• …and {drift.missing.length - 8} more</li>}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={saving}
            onClick={useBuiltIn}
          >
            <RotateCcw className="size-4" /> Use the built-in copy
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {items.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={f}
              onChange={(e) => edit(i, e.target.value)}
              className="h-9 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Move up"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Move down"
              disabled={i === items.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive size-11 sm:size-8"
              aria-label="Remove"
              onClick={() => remove(i)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setItems((p) => [...p, ""])}
        >
          <Plus className="size-4" /> Add feature
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save {meta.name}
        </Button>
      </div>
    </div>
  );
}
