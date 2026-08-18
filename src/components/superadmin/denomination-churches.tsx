"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  addChurches,
  removeChurches,
} from "@/app/superadmin/denominations/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Member = {
  id: string;
  name: string;
  plan: string;
  country: string;
  state: string | null;
};
type Candidate = { id: string; name: string; denomination: string | null };

export function DenominationChurches({
  denominationId,
  members,
  unassigned,
  suggested,
}: {
  denominationId: string;
  members: Member[];
  unassigned: Candidate[];
  suggested: Candidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const suggestedIds = useMemo(
    () => new Set(suggested.map((s) => s.id)),
    [suggested],
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? unassigned.filter((c) => c.name.toLowerCase().includes(q))
      : unassigned;
    // Churches whose own text already mentions this denomination float up.
    return [...list].sort((a, b) => {
      const sa = suggestedIds.has(a.id) ? 0 : 1;
      const sb = suggestedIds.has(b.id) ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name);
    });
  }, [unassigned, query, suggestedIds]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function add(ids: string[]) {
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await addChurches({ id: denominationId, churchIds: ids });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Added ${res.count} church${res.count === 1 ? "" : "es"}.`);
      setPicked(new Set());
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeChurches({ id: denominationId, churchIds: [id] });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Removed from this denomination.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>In this denomination ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No churches yet. Add them from the list beside this one.
            </p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Link
                    href={`/superadmin/churches/${m.id}`}
                    className="hover:text-primary min-w-0 flex-1 truncate font-medium"
                  >
                    {m.name}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {[m.state, m.country].filter(Boolean).join(", ")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => remove(m.id)}
                    aria-label={`Remove ${m.name}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add churches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggested.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => add(suggested.map((s) => s.id))}
              className="bg-primary/5 hover:bg-primary/10 flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors"
            >
              <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
              <span className="text-sm">
                <span className="font-semibold">
                  {suggested.length} church
                  {suggested.length === 1 ? "" : "es"} already say they belong
                  here
                </span>
                <span className="text-muted-foreground block text-xs">
                  Based on what they typed on their own public page. Tap to add
                  them all.
                </span>
              </span>
            </button>
          )}

          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search churches without a denomination…"
              className="pl-9"
            />
          </div>

          <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg border p-1">
            {candidates.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                {unassigned.length === 0
                  ? "Every church already belongs to a denomination."
                  : "No church matches that."}
              </p>
            ) : (
              candidates.map((c) => {
                const on = picked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      on
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {c.name}
                      {c.denomination && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {c.denomination}
                        </span>
                      )}
                    </span>
                    {on && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          <Button
            size="sm"
            className="w-full"
            disabled={pending || picked.size === 0}
            onClick={() => add([...picked])}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add {picked.size > 0 ? picked.size : ""} selected
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
