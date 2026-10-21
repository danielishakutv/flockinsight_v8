"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { savePastor, setPastorBookable } from "@/app/(app)/appointments/actions";
import type { PastorItem, TeamOption, TypeItem } from "@/components/pastoral/appointments-browser";

/**
 * Who can be booked [manage]. A pastor is a member of the TEAM (a login),
 * never a row on the register. Taking somebody off the booking page keeps
 * their history and their upcoming appointments.
 *
 * A pastor whose role does not include the module cannot open their own
 * diary; custom roles were frozen when they were written, so saving says so
 * in words rather than leaving a pastor wondering where their bookings went.
 */
export function PastorRoster({
  pastors,
  team,
  types,
}: {
  pastors: PastorItem[];
  team: TeamOption[];
  types: TypeItem[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<PastorItem | "new" | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  function toggle(p: PastorItem, next: boolean) {
    startTransition(async () => {
      try {
        const res = await setPastorBookable(p.id, next);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(next ? t("pastoral.done.onPage") : t("pastoral.done.offPage", { count: res.untouched }));
        router.refresh();
      } catch (e) {
        console.error("[pastor-roster] could not change bookable", e);
        toast.error(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("pastoral.roster.title")}</CardTitle>
        <Button size="sm" className="min-h-11" onClick={() => setEditing("new")} disabled={team.length === 0}>
          <Plus className="size-4" /> {t("pastoral.roster.add")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {warn && (
          <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {t("pastoral.roster.noAccess", { name: warn })}
          </p>
        )}
        {team.length === 0 && pastors.length > 0 && (
          <p className="text-muted-foreground text-xs">{t("pastoral.roster.noTeam")}</p>
        )}
        {pastors.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("pastoral.empty.noPastors")}</p>
        ) : (
          <ul className="divide-y">
            {pastors.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <UserRound className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.displayName}</p>
                  <p className="text-muted-foreground text-xs">
                    {[p.title, !p.onTeam ? t("pastoral.roster.offTeam") : null, p.hours.length === 0 ? t("pastoral.roster.noHours") : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <label className="flex min-h-11 items-center gap-2 text-xs">
                  {t("pastoral.roster.bookable")}
                  <Switch
                    checked={p.isBookable}
                    disabled={pending || !p.onTeam}
                    onCheckedChange={(v) => toggle(p, v)}
                    aria-label={`${t("pastoral.roster.bookable")}: ${p.displayName}`}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`${t("pastoral.roster.edit")}: ${p.displayName}`}
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <PastorForm
          pastor={editing === "new" ? null : editing}
          team={team}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={(noAccess) => {
            setEditing(null);
            setWarn(noAccess);
            toast.success(t("pastoral.done.saved"));
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function PastorForm({
  pastor,
  team,
  types,
  onClose,
  onSaved,
}: {
  pastor: PastorItem | null;
  team: TeamOption[];
  types: TypeItem[];
  onClose: () => void;
  onSaved: (warnNoAccess: string | null) => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(pastor?.userId ?? team[0]?.userId ?? "");
  const [displayName, setDisplayName] = useState(pastor?.displayName ?? team[0]?.name ?? "");
  const [title, setTitle] = useState(pastor?.title ?? "");
  const [typeIds, setTypeIds] = useState<string[]>(pastor?.typeIds ?? types.filter((ty) => ty.isActive).map((ty) => ty.id));
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await savePastor(
          {
            userId,
            displayName,
            title,
            isBookable: pastor?.isBookable ?? true,
            typeIds,
            slotMinutes: pastor?.slotMinutes ?? 30,
            bufferMinutes: pastor?.bufferMinutes ?? 0,
            minNoticeHours: pastor?.minNoticeHours ?? 12,
            maxAdvanceDays: pastor?.maxAdvanceDays ?? 30,
          },
          pastor?.id,
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onSaved(res.warnNoAccess);
      } catch (e) {
        console.error("[pastor-roster] could not save", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pastor ? t("pastoral.roster.edit") : t("pastoral.roster.add")}</DialogTitle>
        </DialogHeader>

        {!pastor && (
          <div className="space-y-1.5">
            <Label>{t("pastoral.roster.teamMember")}</Label>
            <Select
              value={userId}
              onValueChange={(v) => {
                setUserId(v);
                setDisplayName(team.find((m) => m.userId === v)?.name ?? displayName);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {team.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pr-name">{t("pastoral.roster.displayName")}</Label>
          <Input id="pr-name" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-title">{t("pastoral.roster.jobTitle")}</Label>
          <Input id="pr-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("pastoral.roster.offers")}</legend>
          {types.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t("pastoral.types.none")}</p>
          ) : (
            types.map((ty) => (
              <label key={ty.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={typeIds.includes(ty.id)}
                  onChange={(e) =>
                    setTypeIds((ids) => (e.target.checked ? [...ids, ty.id] : ids.filter((x) => x !== ty.id)))
                  }
                />
                {ty.name}
                {!ty.isActive && <span className="text-muted-foreground text-xs">({t("pastoral.types.retired")})</span>}
              </label>
            ))
          )}
        </fieldset>

        {error && (
          <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending || displayName.trim().length < 2 || !userId} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
