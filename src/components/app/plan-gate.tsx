import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { FEATURES, planNameFor, type FeatureKey } from "@/lib/entitlements";
import { hasFeature } from "@/lib/entitlements-server";
import { Button } from "@/components/ui/button";

/**
 * The banner above a module a church's plan does not include.
 *
 * It sits ON TOP of the module rather than replacing it, which is the whole
 * design: five live churches have records in modules they do not pay for, and
 * taking their own books away to make a point about billing would read, to them,
 * as having lost the data. So the page below this still shows what is there, the
 * writes are refused on the server, and this says what is going on and what it
 * would take.
 *
 * Renders nothing at all when the plan does include the feature, so a page can
 * put it at the top unconditionally and forget about it.
 */
export async function PlanGate({ feature }: { feature: FeatureKey }) {
  if (await hasFeature(feature)) return null;

  const meta = FEATURES[feature];
  return (
    <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/20">
          <Sparkles className="size-5 text-amber-600 dark:text-amber-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {meta.label} is on the {planNameFor(feature)} plan
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">{meta.blurb}</p>
          {/*
            The reassurance has to be here, not in a help article. Somebody who
            opens a page they have been using for months and finds it locked will
            assume the worst thing first.
          */}
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
            <Lock className="size-3.5 shrink-0" />
            Anything you have already entered is safe and still here to read —
            adding and changing is paused until you upgrade.
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/settings/billing">See plans</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The same thing, inline and small, for one gated control inside a page that is
 * otherwise included — "Bulk SMS" on the communication page, say.
 */
export async function PlanNote({ feature }: { feature: FeatureKey }) {
  if (await hasFeature(feature)) return null;
  const meta = FEATURES[feature];
  return (
    <p className="text-muted-foreground mt-1.5 text-xs">
      <Sparkles className="mr-1 inline size-3.5 text-amber-500" />
      {meta.label} is on the {planNameFor(feature)} plan.{" "}
      <Link href="/settings/billing" className="font-semibold underline">
        See plans
      </Link>
    </p>
  );
}
