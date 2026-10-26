"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import type { AdvisorRollout } from "@/lib/ai/settings-rules";
import {
  saveAdvisorRolloutAction,
  searchPilotChurchesAction,
  type PilotChurch,
} from "@/app/superadmin/ai/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const OPTIONS: { key: AdvisorRollout; label: string; hint: string }[] = [
  {
    key: "off",
    label: "Off",
    hint: "No church gets the advisor; every question is answered from the guides. Superadmins acting as a church still can, to test it.",
  },
  {
    key: "pilot",
    label: "Pilot churches",
    hint: "Only the churches listed below, and only where the plan, the owner's consent and the asker's role allow.",
  },
  {
    key: "all",
    label: "Every eligible church",
    hint: "Every church on Growth or above whose owner turned AI features on, for staff who can see analytics, giving and follow-up.",
  },
];

const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", pro: "Pro", enterprise: "Enterprise" };

/** Why the advisor would not answer in this church even when it is in the pilot. Null when it would. */
function blocker(c: PilotChurch): string | null {
  if (!c.name) return "No church has this address.";
  if (c.isDemo) return "The demo church never uses AI.";
  if (!c.advisorOnPlan) return "Below Growth: the advisor is not on this plan.";
  if (!c.aiOn) return "The owner has not turned AI features on.";
  return null;
}

function ChurchLine({ c }: { c: PilotChurch }) {
  const why = blocker(c);
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{c.name ?? c.slug}</p>
      <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
        <span>{c.slug}</span>
        {c.plan && <span>· {PLAN_LABEL[c.plan] ?? c.plan}</span>}
        {c.name && (
          <span className={c.aiOn ? "text-emerald-700 dark:text-emerald-300" : undefined}>
            · AI {c.aiOn ? "on" : "off"}
          </span>
        )}
      </p>
      {why && <p className="text-xs text-amber-700 dark:text-amber-300">{why}</p>}
    </div>
  );
}

/**
 * Who gets the church advisor: nobody, the pilot churches, or every church
 * that is otherwise eligible. The pilot is a list of church addresses
 * (slugs), found by searching here, so a typo cannot be saved from this page.
 * Plan, consent and role still apply on top: the pilot only narrows.
 */
export function AiAdvisorRollout({ rollout, pilot }: { rollout: AdvisorRollout; pilot: PilotChurch[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<AdvisorRollout>(rollout);
  const [list, setList] = useState<PilotChurch[]>(pilot);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PilotChurch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    if (query.trim().length < 2) {
      setError("Type at least two letters of the church's name.");
      return;
    }
    setSearching(true);
    try {
      const res = await searchPilotChurchesAction({ q: query });
      if (res.ok) setResults(res.churches);
      else setError(res.error);
    } catch (e) {
      console.error("[ai-advisor-rollout] search failed", e);
      setError("The search did not go through. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveAdvisorRolloutAction({ rollout: choice, pilot: list.map((c) => c.slug) });
        if (res.ok) {
          toast.success("Advisor rollout saved.");
          router.refresh();
        } else {
          setError(res.error);
          toast.error(res.error);
        }
      } catch (e) {
        console.error("[ai-advisor-rollout] save failed", e);
        setError("The rollout was not saved: the server could not be reached. Try again.");
      }
    });
  }

  const inList = new Set(list.map((c) => c.slug));
  const ready = list.filter((c) => blocker(c) === null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Church advisor rollout</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Who gets the church advisor</legend>
          {OPTIONS.map((o) => (
            <label
              key={o.key}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3",
                choice === o.key && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="advisor-rollout"
                value={o.key}
                className="mt-1 size-4"
                checked={choice === o.key}
                onChange={() => setChoice(o.key)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="text-muted-foreground block text-xs">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className={cn("space-y-3", choice !== "pilot" && "opacity-60")}>
          <div>
            <p className="text-sm font-semibold">
              Pilot churches{" "}
              <span className="text-muted-foreground font-normal">
                ({list.length}, {ready} ready)
              </span>
            </p>
            {choice !== "pilot" && (
              <p className="text-muted-foreground text-xs">Kept, but only used while the rollout is Pilot churches.</p>
            )}
          </div>

          {list.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-sm">
              No pilot churches. With the rollout on Pilot churches, no church gets the advisor.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {list.map((c) => (
                <li key={c.slug} className="flex items-center gap-2 px-3 py-1.5">
                  <ChurchLine c={c} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Remove ${c.name ?? c.slug} from the pilot`}
                    onClick={() => setList((l) => l.filter((x) => x.slug !== c.slug))}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <Input
              type="search"
              aria-label="Search churches by name or address"
              placeholder="Search churches by name or address"
              className="text-base sm:text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={searching} className="shrink-0">
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Search
            </Button>
          </form>

          {results !== null &&
            (results.length === 0 ? (
              <p className="text-muted-foreground text-sm">No church matches &ldquo;{query.trim()}&rdquo;.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {results.map((c) => (
                  <li key={c.slug} className="flex items-center gap-2 px-3 py-1.5">
                    <ChurchLine c={c} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 shrink-0 sm:min-h-0"
                      disabled={inList.has(c.slug)}
                      onClick={() => setList((l) => (l.some((x) => x.slug === c.slug) ? l : [...l, c]))}
                    >
                      <Plus className="size-4" />
                      {inList.has(c.slug) ? "In the pilot" : "Add"}
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </div>

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <Button onClick={save} disabled={pending} className="w-full sm:w-auto">
          Save rollout
        </Button>
      </CardContent>
    </Card>
  );
}
