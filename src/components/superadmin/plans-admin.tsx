"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArchiveRestore, Globe, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  resetTierFeaturesAction,
  saveCustomPlanAction,
  saveTierFeaturesAction,
  setCustomPlanArchivedAction,
} from "@/app/superadmin/plans/actions";
import {
  ALL_FEATURES,
  defaultTierFeatures,
  FEATURES,
  PLAN_ORDER,
  type FeatureKey,
} from "@/lib/entitlements";
import { customPlanKey, PLAN_BY_ID, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Limits = {
  price: number | null;
  memberLimit: number | null;
  teamLimit: number | null;
  emailAllowance: number | null;
  storageMb: number;
};

export type CustomPlanView = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  basePlan: PlanId;
  priceMonthly: number | null;
  memberLimit: number | null;
  teamLimit: number | null;
  emailAllowance: number | null;
  storageMb: number;
  features: FeatureKey[];
  highlights: string[];
  showOnWebsite: boolean;
  sortOrder: number;
  archived: boolean;
};

/** Features grouped by the tier they ship on — the order the price list reads in. */
const GROUPS = PLAN_ORDER.map((tier) => ({
  tier,
  keys: ALL_FEATURES.filter((k) => FEATURES[k].plan === tier),
}));

const naira = (n: number | null) =>
  n === null ? "Contact us" : n === 0 ? "Free" : `₦${n.toLocaleString()}/mo`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const labelList = (keys: FeatureKey[]) => keys.map((k) => FEATURES[k].label).join(", ");

export function PlansAdmin({
  tiers,
  changed,
  churches,
  tierDefaults,
  customPlans,
}: {
  tiers: Record<PlanId, readonly FeatureKey[]>;
  /** How many saved changes from the defaults each tier carries. */
  changed: Record<PlanId, number>;
  /** Churches per plan key ("growth", "custom:<id>"). */
  churches: Record<string, number>;
  tierDefaults: Record<PlanId, Limits>;
  customPlans: CustomPlanView[];
}) {
  return (
    <div className="space-y-6">
      <TierMatrix tiers={tiers} changed={changed} churches={churches} />
      <CustomPlans
        tiers={tiers}
        churches={churches}
        tierDefaults={tierDefaults}
        plans={customPlans}
      />
    </div>
  );
}

/* ============================================================
 * The four tiers
 * ========================================================== */

function TierMatrix({
  tiers,
  changed,
  churches,
}: {
  tiers: Record<PlanId, readonly FeatureKey[]>;
  changed: Record<PlanId, number>;
  churches: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const fresh = () =>
    Object.fromEntries(PLAN_ORDER.map((t) => [t, new Set(tiers[t])])) as Record<
      PlanId,
      Set<FeatureKey>
    >;
  const [ticks, setTicks] = useState(fresh);
  const defaults = useMemo(
    () =>
      Object.fromEntries(PLAN_ORDER.map((t) => [t, new Set(defaultTierFeatures(t))])) as Record<
        PlanId,
        Set<FeatureKey>
      >,
    [],
  );

  // What saving would do, per tier, against what is live now.
  const edits = PLAN_ORDER.map((t) => ({
    tier: t,
    on: ALL_FEATURES.filter((k) => ticks[t].has(k) && !tiers[t].includes(k)),
    off: ALL_FEATURES.filter((k) => !ticks[t].has(k) && tiers[t].includes(k)),
  })).filter((e) => e.on.length || e.off.length);

  const toggle = (t: PlanId, k: FeatureKey) =>
    setTicks((prev) => {
      const next = { ...prev, [t]: new Set(prev[t]) };
      if (next[t].has(k)) next[t].delete(k);
      else next[t].add(k);
      return next;
    });

  const save = () =>
    start(async () => {
      for (const e of edits) {
        const res = await saveTierFeaturesAction({ tier: e.tier, features: [...ticks[e.tier]] });
        if (!res.ok) {
          toast.error(`${PLAN_BY_ID[e.tier].name}: ${res.error}`);
          return;
        }
      }
      toast.success("Saved. Churches on those plans have the change now.");
      router.refresh();
    });

  const reset = (t: PlanId) =>
    start(async () => {
      const res = await resetTierFeaturesAction(t);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTicks((prev) => ({ ...prev, [t]: new Set(defaultTierFeatures(t)) }));
      toast.success(`${PLAN_BY_ID[t].name} is back to its defaults.`);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">What each plan includes</CardTitle>
        <p className="text-muted-foreground text-sm">
          Every box starts at the plan the feature ships on. A box you change is
          ringed in amber, and a feature added to FlockInsight later still lands
          on its own plan — your changes are kept as changes, never as a frozen
          list. The sentences on the pricing page are written separately, at{" "}
          <Link href="/superadmin/pricing" className="text-primary font-semibold underline">
            Pricing
          </Link>
          : if you move a feature, update them there too.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScrollableTable label="Features by plan" stickyFirstColumn>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="bg-card py-2 pr-3 font-semibold">Feature</th>
                {PLAN_ORDER.map((t) => (
                  <th key={t} className="px-2 py-2 text-center align-bottom font-semibold">
                    <div>{PLAN_BY_ID[t].name}</div>
                    <div className="text-muted-foreground text-xs font-normal">
                      {plural(churches[t] ?? 0, "church", "churches")}
                    </div>
                    {changed[t] > 0 && (
                      <button
                        type="button"
                        onClick={() => reset(t)}
                        disabled={pending}
                        className="text-primary mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
                        title={`Undo ${plural(changed[t], "change")} and use what the code ships`}
                      >
                        <RotateCcw className="size-3" />
                        Defaults
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {GROUPS.map((g) => (
              <tbody key={g.tier}>
                <tr>
                  <th
                    colSpan={5}
                    className="bg-muted/50 text-muted-foreground px-2 py-1.5 text-left text-xs font-bold tracking-wide uppercase"
                  >
                    Ships on {PLAN_BY_ID[g.tier].name}
                  </th>
                </tr>
                {g.keys.map((k) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="bg-card max-w-[280px] py-2 pr-3">
                      <div className="font-medium">{FEATURES[k].label}</div>
                      <div className="text-muted-foreground line-clamp-2 text-xs">
                        {FEATURES[k].blurb}
                      </div>
                    </td>
                    {PLAN_ORDER.map((t) => {
                      const on = ticks[t].has(k);
                      const differs = on !== defaults[t].has(k);
                      return (
                        <td key={t} className="px-2 py-2 text-center">
                          <label
                            className={cn(
                              "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg",
                              differs && "ring-2 ring-amber-500/70",
                            )}
                            title={
                              differs
                                ? `Changed — by default ${PLAN_BY_ID[t].name} ${defaults[t].has(k) ? "includes" : "does not include"} this`
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              className="accent-primary size-4"
                              checked={on}
                              onChange={() => toggle(t, k)}
                              aria-label={`${FEATURES[k].label} on ${PLAN_BY_ID[t].name}`}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </ScrollableTable>

        {edits.length > 0 && (
          <div className="bg-background/95 sticky bottom-2 z-10 space-y-2 rounded-xl border border-amber-500/50 p-3 shadow-lg backdrop-blur-sm">
            <p className="text-sm font-semibold">Not saved yet</p>
            <ul className="space-y-1 text-sm">
              {edits.map((e) => (
                <li key={e.tier}>
                  <span className="font-semibold">{PLAN_BY_ID[e.tier].name}</span>
                  {e.on.length > 0 && <> — adds {labelList(e.on)}</>}
                  {e.off.length > 0 && <> — removes {labelList(e.off)}</>}
                  <span className="text-muted-foreground">
                    {" "}
                    · {plural(churches[e.tier] ?? 0, "church", "churches")} on it
                    {e.off.length > 0 &&
                      " keep reading what they entered there, but cannot add to it"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Save changes
              </Button>
              <Button variant="outline" onClick={() => setTicks(fresh())} disabled={pending}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Custom plans
 * ========================================================== */

function CustomPlans({
  tiers,
  churches,
  tierDefaults,
  plans,
}: {
  tiers: Record<PlanId, readonly FeatureKey[]>;
  churches: Record<string, number>;
  tierDefaults: Record<PlanId, Limits>;
  plans: CustomPlanView[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<CustomPlanView | "new" | null>(null);

  const archive = (p: CustomPlanView, archived: boolean) =>
    start(async () => {
      const res = await setCustomPlanArchivedAction(p.id, archived);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(archived ? `${p.name} archived.` : `${p.name} restored.`);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-lg">Custom plans</CardTitle>
          <p className="text-muted-foreground text-sm">
            A plan of your own starts from one of the four and changes what it
            needs to. Put it on the website for churches to choose and pay for,
            or keep it off and give it to a church from its page in Churches.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus /> New plan
        </Button>
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No custom plans yet. A student fellowship plan, say: start from
            Starter, add Training, set a lower price, and put it on the website.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => {
              const base = tiers[p.basePlan];
              const added = p.features.filter((k) => !base.includes(k));
              const removed = base.filter((k) => !p.features.includes(k));
              const n = churches[customPlanKey(p.id)] ?? 0;
              return (
                <div
                  key={p.id}
                  className={cn("flex flex-col rounded-2xl border p-4", p.archived && "opacity-60")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-base font-extrabold">{p.name}</h3>
                    {p.archived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : p.showOnWebsite ? (
                      <Badge variant="success">
                        <Globe className="size-3" /> On the website
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not on the website</Badge>
                    )}
                  </div>
                  {p.tagline && (
                    <p className="text-muted-foreground mt-0.5 text-sm">{p.tagline}</p>
                  )}
                  <p className="mt-2 text-lg font-extrabold">{naira(p.priceMonthly)}</p>
                  <p className="text-muted-foreground text-xs">
                    From {PLAN_BY_ID[p.basePlan].name}
                    {added.length > 0 && ` · adds ${labelList(added)}`}
                    {removed.length > 0 && ` · without ${labelList(removed)}`}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {p.memberLimit === null ? "Unlimited members" : `Up to ${p.memberLimit.toLocaleString()} members`}
                    {" · "}
                    {p.teamLimit === null ? "unlimited team" : plural(p.teamLimit, "team login")}
                    {" · "}
                    {plural(n, "church", "churches")} on it
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                      <Pencil /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => archive(p, !p.archived)}
                      disabled={pending}
                      title={
                        p.archived
                          ? "Make it available again"
                          : "Take it off the website and out of the pickers. Churches on it keep it."
                      }
                    >
                      {p.archived ? <ArchiveRestore /> : <Archive />}
                      {p.archived ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {editing && (
        <CustomPlanEditor
          key={editing === "new" ? "new" : editing.id}
          plan={editing === "new" ? null : editing}
          tiers={tiers}
          tierDefaults={tierDefaults}
          churchesOnIt={editing === "new" ? 0 : (churches[customPlanKey(editing.id)] ?? 0)}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Blank → null ("unlimited" / "contact us"); otherwise a whole number, or NaN. */
const parseOptional = (s: string): number | null =>
  s.trim() === "" ? null : Number(s.replace(/[,\s₦]/g, ""));
const show = (n: number | null) => (n === null ? "" : String(n));

function CustomPlanEditor({
  plan,
  tiers,
  tierDefaults,
  churchesOnIt,
  onClose,
}: {
  plan: CustomPlanView | null;
  tiers: Record<PlanId, readonly FeatureKey[]>;
  tierDefaults: Record<PlanId, Limits>;
  churchesOnIt: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const startBase: PlanId = plan?.basePlan ?? "starter";
  const seed = plan
    ? {
        price: plan.priceMonthly,
        memberLimit: plan.memberLimit,
        teamLimit: plan.teamLimit,
        emailAllowance: plan.emailAllowance,
        storageMb: plan.storageMb,
      }
    : tierDefaults[startBase];

  const [name, setName] = useState(plan?.name ?? "");
  const [tagline, setTagline] = useState(plan?.tagline ?? "");
  const [base, setBase] = useState<PlanId>(startBase);
  const [price, setPrice] = useState(show(seed.price));
  const [members, setMembers] = useState(show(seed.memberLimit));
  const [team, setTeam] = useState(show(seed.teamLimit));
  const [emails, setEmails] = useState(show(seed.emailAllowance));
  const [storage, setStorage] = useState(String(seed.storageMb));
  const [ticks, setTicks] = useState<Set<FeatureKey>>(
    new Set(plan?.features ?? tiers[startBase]),
  );
  const [highlights, setHighlights] = useState((plan?.highlights ?? []).join("\n"));
  const [onWebsite, setOnWebsite] = useState(plan?.showOnWebsite ?? false);

  const baseSet = new Set(tiers[base]);

  /*
   * Changing the starting plan starts the ticks again from that plan — the
   * point of "start from" is that you only touch what differs. A new plan
   * also takes that plan's limits; an existing one keeps the numbers somebody
   * already chose.
   */
  const changeBase = (b: PlanId) => {
    setBase(b);
    setTicks(new Set(tiers[b]));
    if (!plan) {
      const d = tierDefaults[b];
      setPrice(show(d.price));
      setMembers(show(d.memberLimit));
      setTeam(show(d.teamLimit));
      setEmails(show(d.emailAllowance));
      setStorage(String(d.storageMb));
    }
  };

  const toggle = (k: FeatureKey) =>
    setTicks((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = () => {
    const nums = {
      priceMonthly: parseOptional(price),
      memberLimit: parseOptional(members),
      teamLimit: parseOptional(team),
      emailAllowance: parseOptional(emails),
    };
    for (const [field, v] of Object.entries(nums)) {
      if (v !== null && !Number.isInteger(v)) {
        toast.error(
          {
            priceMonthly: "The price must be a whole number of naira, or blank for “contact us”.",
            memberLimit: "The member limit must be a whole number, or blank for unlimited.",
            teamLimit: "The team size must be a whole number, or blank for unlimited.",
            emailAllowance: "Emails must be a whole number, or blank for unlimited.",
          }[field] ?? "Check the numbers.",
        );
        return;
      }
    }
    const storageMb = Number(storage);
    if (!Number.isInteger(storageMb) || storageMb < 0) {
      toast.error("Storage must be a whole number of megabytes.");
      return;
    }
    start(async () => {
      const res = await saveCustomPlanAction({
        id: plan?.id,
        name,
        tagline,
        basePlan: base,
        ...nums,
        storageMb,
        features: [...ticks],
        highlights: highlights
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        showOnWebsite: onWebsite,
        sortOrder: plan?.sortOrder ?? 0,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(plan ? "Plan saved." : "Plan created.");
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : "New plan"}</DialogTitle>
          <DialogDescription>
            {plan && churchesOnIt > 0
              ? `${plural(churchesOnIt, "church", "churches")} on this plan will have any change straight away.`
              : "Start from the plan it is closest to, then change only what differs."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-name">Name</Label>
              <Input
                id="cp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Student Fellowship"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start from</Label>
              <Select value={base} onValueChange={(v) => changeBase(v as PlanId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PLAN_BY_ID[t].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cp-tagline">One line about who it is for</Label>
              <Input
                id="cp-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="For campus fellowships and student ministries."
                maxLength={140}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              id="cp-price"
              label="Price a month (₦)"
              value={price}
              onChange={setPrice}
              hint="Blank: “contact us”. 0: free."
            />
            <NumberField
              id="cp-members"
              label="Members"
              value={members}
              onChange={setMembers}
              hint="Blank: unlimited."
            />
            <NumberField
              id="cp-team"
              label="Team logins"
              value={team}
              onChange={setTeam}
              hint="Blank: unlimited."
            />
            <NumberField
              id="cp-emails"
              label="Emails a month"
              value={emails}
              onChange={setEmails}
              hint="Blank: unlimited."
            />
            <NumberField
              id="cp-storage"
              label="Storage (MB)"
              value={storage}
              onChange={setStorage}
            />
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">
            Anything not set here — a meeting&apos;s room size, the assistant&apos;s
            questions a month — follows {PLAN_BY_ID[base].name}.
          </p>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Label>Features</Label>
              <button
                type="button"
                onClick={() => setTicks(new Set(tiers[base]))}
                className="text-primary min-h-8 text-xs font-semibold underline-offset-2 hover:underline"
              >
                Match {PLAN_BY_ID[base].name}
              </button>
            </div>
            <div className="space-y-3">
              {GROUPS.map((g) => (
                <div key={g.tier}>
                  <p className="text-muted-foreground mb-1 text-xs font-bold tracking-wide uppercase">
                    Ships on {PLAN_BY_ID[g.tier].name}
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {g.keys.map((k) => {
                      const on = ticks.has(k);
                      const differs = on !== baseSet.has(k);
                      return (
                        <label
                          key={k}
                          className={cn(
                            "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm",
                            differs ? "bg-amber-500/10" : "hover:bg-muted/50",
                          )}
                          title={FEATURES[k].blurb}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-4 shrink-0"
                            checked={on}
                            onChange={() => toggle(k)}
                          />
                          <span className="min-w-0 flex-1">{FEATURES[k].label}</span>
                          {differs && (
                            <span className="shrink-0 text-[10px] font-bold text-amber-700 uppercase dark:text-amber-400">
                              {on ? "added" : "removed"}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-highlights">What its card says on the website</Label>
            <Textarea
              id="cp-highlights"
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              rows={4}
              placeholder={"Everything a campus fellowship needs\nTraining & classes with badges\nUp to 300 members"}
            />
            <p className="text-muted-foreground text-xs">
              One line each, as a pastor would want to read them. Leave it blank
              and the card lists the ticked features by name. The member,
              storage and email lines are added for you from the numbers above.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border p-3">
            <Switch
              checked={onWebsite}
              onCheckedChange={setOnWebsite}
              disabled={!!plan?.archived}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-semibold">Show on the website</span>
              <span className="text-muted-foreground block">
                On the pricing page and the home page, and in Settings → Billing
                so a church can choose it and pay for it. Off: only a superadmin
                can put a church on it, from the church&apos;s page.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || name.trim().length < 2}>
            {pending && <Loader2 className="animate-spin" />}
            {plan ? "Save plan" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
