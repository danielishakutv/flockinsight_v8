"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PlanId } from "@/lib/plans";
import type { AssistantAllowances } from "@/lib/ai/settings-rules";
import { saveAssistantAllowancesAction } from "@/app/superadmin/ai/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLANS: { key: PlanId; label: string }[] = [
  { key: "starter", label: "Starter" },
  { key: "growth", label: "Growth" },
  { key: "pro", label: "Pro" },
  { key: "enterprise", label: "Enterprise" },
];

type Draft = Record<PlanId | "perPersonDaily", string>;

function draftOf(a: AssistantAllowances): Draft {
  const s = (n: number | null) => (n === null ? "" : String(n));
  return {
    starter: s(a.starter),
    growth: s(a.growth),
    pro: s(a.pro),
    enterprise: s(a.enterprise),
    perPersonDaily: String(a.perPersonDaily),
  };
}

/** A whole number, or null for an empty box. Undefined when it is neither. */
function wholeOrBlank(v: string): number | null | undefined {
  const t = v.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/**
 * How many questions each church may ask a month, by plan, and each person a
 * day. An empty plan box means no monthly limit; the day can never be empty,
 * because one person holding Enter must never be able to spend a church's
 * month. Defaults are the price list's numbers (lib/entitlements.ts); saving
 * here overrides them for every church on the next question.
 */
export function AiAllowances({
  allowances,
  defaults,
  adminDaily,
  max,
}: {
  allowances: AssistantAllowances;
  defaults: AssistantAllowances;
  /** A superadmin's own day, set in code (ASSISTANT_ADMIN_DAILY). Shown, not edited. */
  adminDaily: number;
  max: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => draftOf(allowances));
  const [error, setError] = useState<string | null>(null);

  function save(values: Draft) {
    setError(null);
    const plans = Object.fromEntries(PLANS.map((p) => [p.key, wholeOrBlank(values[p.key])])) as Record<
      PlanId,
      number | null | undefined
    >;
    const daily = wholeOrBlank(values.perPersonDaily);
    if (Object.values(plans).some((v) => v === undefined || (v !== null && v > max))) {
      setError(`Each plan's allowance must be a whole number up to ${max.toLocaleString("en")}, or empty for no limit.`);
      return;
    }
    if (daily === undefined || daily === null || daily > max) {
      setError(`The daily limit per person must be a whole number up to ${max.toLocaleString("en")}. It cannot be empty.`);
      return;
    }
    startTransition(async () => {
      const res = await saveAssistantAllowancesAction({ ...plans, perPersonDaily: daily });
      if (res.ok) {
        toast.success("Question allowances saved.");
        router.refresh();
      } else {
        setError(res.error);
        toast.error(res.error);
      }
    });
  }

  const changedFromDefaults = JSON.stringify(draftOf(defaults)) !== JSON.stringify(draft);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assistant question allowances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Counted per church per calendar month and per person per day, both in UTC, before the model is asked.
          A question that got no usable answer (nothing sent, cut off, a provider error) is handed back. Leave a
          plan empty for no monthly limit.
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Questions a month, per church</legend>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div key={plan.key} className="space-y-1">
                <Label htmlFor={`assistant-allowance-${plan.key}`}>{plan.label}</Label>
                <Input
                  id={`assistant-allowance-${plan.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  step={1}
                  placeholder="No limit"
                  value={draft[plan.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [plan.key]: e.target.value }))}
                />
                <p className="text-muted-foreground text-xs">
                  Price list: {defaults[plan.key] === null ? "no limit" : defaults[plan.key]?.toLocaleString("en")}
                </p>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1 sm:max-w-xs">
          <Label htmlFor="assistant-allowance-daily">Questions a day, per person</Label>
          <Input
            id="assistant-allowance-daily"
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            step={1}
            value={draft.perPersonDaily}
            onChange={(e) => setDraft((d) => ({ ...d, perPersonDaily: e.target.value }))}
          />
          <p className="text-muted-foreground text-xs">
            Every church&apos;s staff. A superadmin&apos;s own day is {adminDaily}, set in code, and is charged to
            the platform.
          </p>
        </div>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => save(draft)} disabled={pending} className="w-full sm:w-auto">
            Save allowances
          </Button>
          {changedFromDefaults && (
            <Button
              variant="outline"
              disabled={pending}
              className="w-full sm:w-auto"
              onClick={() => {
                const d = draftOf(defaults);
                setDraft(d);
                save(d);
              }}
            >
              Back to the price list
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
