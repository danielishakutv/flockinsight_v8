"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import { saveBookingType, setBookingTypeActive } from "@/app/(app)/appointments/actions";
import { LOCATIONS, locationKey, type PastoralLocation } from "@/lib/pastoral-shared";
import type { PastorItem, TypeItem } from "@/components/pastoral/appointments-browser";

/**
 * What somebody can book, and who offers it [manage]. Retired rather than
 * deleted: old appointments still name the type, and a texted confirmation
 * already said "Counselling".
 */
export function BookingTypesEditor({ types, pastors }: { types: TypeItem[]; pastors: PastorItem[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<TypeItem | "new" | null>(null);

  function setActive(ty: TypeItem, next: boolean) {
    startTransition(async () => {
      try {
        const res = await setBookingTypeActive(ty.id, next);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        console.error("[booking-types] could not change active", e);
        toast.error(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="min-h-11" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> {t("pastoral.types.add")}
        </Button>
      </div>
      {types.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          {t("pastoral.types.none")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {types.map((ty) => (
            <Card key={ty.id} className={cn(!ty.isActive && "opacity-60")}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{ty.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {t(locationKey(ty.location))} ·{" "}
                      {ty.durationMinutes ? t("pastoral.ui.minutes", { count: ty.durationMinutes }) : t("pastoral.types.pastorsSlot")}
                    </p>
                  </div>
                  {!ty.isActive && <Badge variant="secondary">{t("pastoral.types.retired")}</Badge>}
                  {ty.isActive && ty.requiresApproval && <Badge variant="outline">{t("pastoral.types.needsConfirm")}</Badge>}
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("pastoral.types.offeredBy")}:{" "}
                  {ty.pastorIds.length
                    ? pastors.filter((p) => ty.pastorIds.includes(p.id)).map((p) => p.displayName).join(", ")
                    : "—"}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setEditing(ty)}>
                    <Pencil className="size-3.5" /> {t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11"
                    disabled={pending}
                    onClick={() => setActive(ty, !ty.isActive)}
                  >
                    {ty.isActive ? t("pastoral.types.retire") : t("pastoral.types.restore")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TypeForm
          type={editing === "new" ? null : editing}
          pastors={pastors}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success(t("pastoral.done.saved"));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TypeForm({
  type,
  pastors,
  onClose,
  onSaved,
}: {
  type: TypeItem | null;
  pastors: PastorItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [duration, setDuration] = useState(type?.durationMinutes ? String(type.durationMinutes) : "");
  const [location, setLocation] = useState<PastoralLocation>((type?.location as PastoralLocation) ?? "church");
  const [requiresApproval, setRequiresApproval] = useState(type?.requiresApproval ?? false);
  const [pastorIds, setPastorIds] = useState<string[]>(type?.pastorIds ?? pastors.map((p) => p.id));
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveBookingType(
          {
            name,
            description,
            durationMinutes: duration.trim() ? Number(duration) : null,
            location,
            requiresApproval,
            pastorIds,
          },
          type?.id,
        );
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onSaved();
      } catch (e) {
        console.error("[booking-types] could not save", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? t("pastoral.types.edit") : t("pastoral.types.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bt-name">{t("pastoral.types.name")}</Label>
          <Input id="bt-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <p className="text-muted-foreground text-xs">{t("pastoral.types.nameHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-desc">{t("pastoral.types.description")}</Label>
          <Textarea id="bt-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bt-duration">{t("pastoral.types.duration")}</Label>
            <Input
              id="bt-duration"
              type="number"
              inputMode="numeric"
              min={10}
              max={480}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t("pastoral.types.durationHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t("pastoral.types.location")}</Label>
            <Select value={location} onValueChange={(v) => setLocation(v as PastoralLocation)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATIONS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {t(l.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t("pastoral.types.requiresApproval")}</p>
            <p className="text-muted-foreground text-xs">{t("pastoral.types.requiresApprovalHint")}</p>
          </div>
          <Switch
            checked={requiresApproval}
            onCheckedChange={setRequiresApproval}
            aria-label={t("pastoral.types.requiresApproval")}
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("pastoral.types.offeredBy")}</legend>
          {pastors.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t("pastoral.types.noPastorsYet")}</p>
          ) : (
            pastors.map((p) => (
              <label key={p.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={pastorIds.includes(p.id)}
                  onChange={(e) =>
                    setPastorIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))
                  }
                />
                {p.displayName}
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
          <Button disabled={pending || name.trim().length < 2} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
