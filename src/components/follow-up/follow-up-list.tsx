"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ChevronRight, HeartHandshake, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { setInFollowUp } from "@/app/(app)/follow-up/actions";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_VARIANT,
  effectiveStatus,
  type FollowUpStatus,
} from "@/components/follow-up/labels";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FollowUpPerson = {
  id: string;
  name: string;
  phone: string | null;
  memberStatus: "active" | "inactive" | "visitor" | "new_convert";
  followUpStatus: FollowUpStatus | null;
  assignedName: string | null;
  lastContactedAt: string | null;
  interactions: number;
};

type Candidate = { id: string; name: string };

const MEMBER_STATUS_LABEL: Record<FollowUpPerson["memberStatus"], string> = {
  active: "Member",
  inactive: "Inactive",
  visitor: "Visitor",
  new_convert: "New convert",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function FollowUpList({
  people,
  candidates,
  canManage = true,
}: {
  people: FollowUpPerson[];
  candidates: Candidate[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FollowUpStatus | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [pickId, setPickId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const m = new Map<FollowUpStatus, number>();
    for (const p of people) {
      const s = effectiveStatus(p.followUpStatus);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [people]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? people
        : people.filter((p) => effectiveStatus(p.followUpStatus) === filter),
    [people, filter],
  );

  function add() {
    if (!pickId) return;
    startTransition(async () => {
      const res = await setInFollowUp(pickId, true);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Added to follow-up");
      setAddOpen(false);
      setPickId("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={`All (${people.length})`}
        />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={`${STATUS_LABEL[s]} (${counts.get(s) ?? 0})`}
          />
        ))}
        {canManage && (
          <div className="ml-auto">
            <Button onClick={() => setAddOpen(true)} size="lg">
              <Plus className="size-5" />
              Add to follow-up
            </Button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <HeartHandshake className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {people.length === 0
                ? "No one to follow up yet. Visitors and new converts show up here automatically."
                : "No one in this stage."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const s = effectiveStatus(p.followUpStatus);
            return (
              <Link
                key={p.id}
                href={`/follow-up/${p.id}`}
                className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition-colors"
              >
                <Avatar className="size-11">
                  <AvatarFallback className="bg-primary/15 text-primary font-bold">
                    {initials(p.name) || "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold">{p.name}</p>
                    <Badge variant="outline" className="shrink-0">
                      {MEMBER_STATUS_LABEL[p.memberStatus]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {p.phone || "No phone"} ·{" "}
                    {p.lastContactedAt
                      ? `last contacted ${format(parseISO(p.lastContactedAt), "MMM d")}`
                      : "not contacted"}
                    {p.assignedName ? ` · ${p.assignedName}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[s]} className="shrink-0">
                  {STATUS_LABEL[s]}
                </Badge>
                <ChevronRight className="text-muted-foreground size-5 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(o) => !pending && setAddOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a member to follow-up</DialogTitle>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Every active member is already being followed up.
            </p>
          ) : (
            <Select value={pickId} onValueChange={setPickId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={add} disabled={pending || !pickId}>
              {pending && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
