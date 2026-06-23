"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { deleteGroup } from "@/app/(app)/groups/actions";
import { GroupFormDialog } from "@/components/groups/group-form-dialog";
import {
  TYPE_LABEL,
  TYPE_VARIANT,
  meetingLabel,
  type GroupType,
} from "@/components/groups/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type GroupRow = {
  id: string;
  name: string;
  type: GroupType;
  description: string | null;
  meetingDay: number | null;
  meetingTime: string | null;
  isActive: boolean;
  leaders: string[];
  memberCount: number;
};

type Candidate = { id: string; name: string };

export function GroupsList({
  groups,
  candidates,
}: {
  groups: GroupRow[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<GroupType | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const presentTypes = useMemo(() => {
    const set = new Set<GroupType>();
    for (const g of groups) set.add(g.type);
    return [...set];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (typeFilter !== "all" && g.type !== typeFilter) return false;
      if (!q) return true;
      return [g.name, g.description, ...g.leaders]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [groups, query, typeFilter]);

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteGroup(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Group deleted");
      setConfirmId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups, ministries or leaders"
            className="pl-9"
          />
        </div>
        <Button onClick={() => setAddOpen(true)} size="lg">
          <Plus className="size-5" />
          New group
        </Button>
      </div>

      {presentTypes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
            label={`All (${groups.length})`}
          />
          {presentTypes.map((t) => (
            <FilterChip
              key={t}
              active={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              label={`${TYPE_LABEL[t]} (${groups.filter((g) => g.type === t).length})`}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <UsersRound className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {groups.length === 0
                ? "No groups or ministries yet. Create one to start organising your members."
                : "No groups match your search."}
            </p>
            {groups.length === 0 && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-5" /> Create your first group
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((g) => {
            const meets = meetingLabel(g.meetingDay, g.meetingTime);
            return (
              <div
                key={g.id}
                className="bg-card hover:border-primary/40 group/card relative flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-colors"
              >
                <Link href={`/groups/${g.id}`} className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-lg font-bold">{g.name}</p>
                    <Badge variant={TYPE_VARIANT[g.type]} className="shrink-0">
                      {TYPE_LABEL[g.type]}
                    </Badge>
                  </div>
                  {g.description && (
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                      {g.description}
                    </p>
                  )}
                  <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <UsersRound className="size-4" />
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </span>
                    {g.leaders.length > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-4" />
                        {g.leaders[0]}
                        {g.leaders.length > 1
                          ? ` +${g.leaders.length - 1}`
                          : ""}
                      </span>
                    )}
                    {meets && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4" />
                        {meets}
                      </span>
                    )}
                  </div>
                </Link>

                <div className="flex items-center justify-between">
                  {!g.isActive ? (
                    <Badge variant="outline">Inactive</Badge>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-1">
                    {confirmId === g.id ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(g.id)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          "Confirm delete"
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete group"
                        onClick={() => setConfirmId(g.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                    <Link
                      href={`/groups/${g.id}`}
                      aria-label={`Open ${g.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className="size-5" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GroupFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        candidates={candidates}
        onSaved={(id) => router.push(`/groups/${id}`)}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground rounded-full px-3 py-1.5 text-sm font-semibold"
          : "bg-muted text-muted-foreground hover:bg-muted/70 rounded-full px-3 py-1.5 text-sm font-semibold"
      }
    >
      {label}
    </button>
  );
}
