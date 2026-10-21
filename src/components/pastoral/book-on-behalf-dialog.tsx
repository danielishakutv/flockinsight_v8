"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { bookOnBehalf, listSlotsForStaff } from "@/app/(app)/appointments/actions";
import { locationKey } from "@/lib/pastoral-shared";
import { wallInputToIso } from "@/lib/pastoral-slots";
import { SlotPicker } from "@/components/pastoral/slot-picker";
import type { MemberOption, PastorItem, TypeItem } from "@/components/pastoral/appointments-browser";

/**
 * The office booking for somebody: on the phone, at the door, after a
 * service. Picks somebody from the register (their contact is copied from it
 * on the server) or takes a name and a number, then a type, a pastor and one
 * of that pastor's open times.
 *
 * "Ignore working hours" is shown only to managers, and the server honours
 * it only for them. It skips the grid, never the clash rules.
 */
export function BookOnBehalfDialog({
  open,
  onOpenChange,
  pastors,
  types,
  members,
  zone,
  fromDay,
  canManage,
  defaultPastorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pastors: PastorItem[];
  types: TypeItem[];
  members: MemberOption[];
  zone: string;
  fromDay: string;
  canManage: boolean;
  defaultPastorId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [who, setWho] = useState<"register" | "other">("register");
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pastorId, setPastorId] = useState<string>(
    defaultPastorId && pastors.some((p) => p.id === defaultPastorId) ? defaultPastorId : (pastors[0]?.id ?? ""),
  );
  const offered = types.filter((ty) => ty.pastorIds.includes(pastorId));
  const [typeId, setTypeId] = useState<string>(offered[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [ignoreHours, setIgnoreHours] = useState(false);
  const [manual, setManual] = useState("");
  const [address, setAddress] = useState("");
  const [topic, setTopic] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const type = types.find((ty) => ty.id === typeId) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [members, query]);
  const chosen = members.find((m) => m.id === memberId) ?? null;

  const pickPastor = (id: string) => {
    setPastorId(id);
    const next = types.filter((ty) => ty.pastorIds.includes(id));
    if (!next.some((ty) => ty.id === typeId)) setTypeId(next[0]?.id ?? "");
    setStartsAt(null);
  };

  const at = ignoreHours ? wallInputToIso(manual, zone) : startsAt;
  const ready = !!pastorId && !!typeId && !!at && (who === "register" ? !!memberId : name.trim().length >= 2);

  function submit() {
    if (!at) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await bookOnBehalf({
          pastorId,
          typeId,
          startsAt: at,
          memberId: who === "register" ? memberId : null,
          name: who === "other" ? name : null,
          phone: who === "other" ? phone : null,
          email: who === "other" ? email : null,
          address,
          topic,
          allowOutsideHours: ignoreHours,
          sendConfirmation,
        });
        if (!res.ok) {
          setError(res.error);
          if (res.taken) {
            setStartsAt(null);
            setReloadKey((k) => k + 1);
          }
          return;
        }
        toast.success(t("pastoral.done.booked"));
        onOpenChange(false);
        router.refresh();
      } catch (e) {
        console.error("[book-on-behalf] booking failed", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("pastoral.behalf.title")}</DialogTitle>
          <DialogDescription>{t("pastoral.public.timesIn", { zone })}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted inline-flex w-full rounded-xl p-1">
          {(["register", "other"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setWho(k)}
              className={cn(
                "min-h-11 flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                who === k ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {k === "register" ? t("pastoral.behalf.fromRegister") : t("pastoral.behalf.someoneElse")}
            </button>
          ))}
        </div>

        {who === "register" ? (
          <div className="space-y-1.5">
            <Label htmlFor="bb-search">{t("pastoral.behalf.searchMember")}</Label>
            <Input
              id="bb-search"
              value={chosen ? chosen.name : query}
              onChange={(e) => {
                setMemberId(null);
                setQuery(e.target.value);
              }}
              autoComplete="off"
            />
            {!chosen && query.trim().length >= 2 && (
              <ul className="divide-y rounded-xl border">
                {matches.length === 0 ? (
                  <li className="text-muted-foreground px-3 py-2 text-sm">{t("pastoral.behalf.noMatch")}</li>
                ) : (
                  matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="hover:bg-muted min-h-11 w-full px-3 py-2 text-left text-sm"
                        onClick={() => setMemberId(m.id)}
                      >
                        {m.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="bb-name">{t("pastoral.public.name")}</Label>
              <Input id="bb-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bb-phone">{t("pastoral.public.phone")}</Label>
              <Input id="bb-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bb-email">{t("pastoral.public.email")}</Label>
              <Input id="bb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("pastoral.behalf.pastor")}</Label>
            <Select value={pastorId} onValueChange={pickPastor}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pastors.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("pastoral.behalf.type")}</Label>
            <Select
              value={typeId}
              onValueChange={(v) => {
                setTypeId(v);
                setStartsAt(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offered.map((ty) => (
                  <SelectItem key={ty.id} value={ty.id}>
                    {ty.name} · {t(locationKey(ty.location))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{t("pastoral.behalf.ignoreHours")}</p>
              <p className="text-muted-foreground text-xs">{t("pastoral.behalf.ignoreHoursHint")}</p>
            </div>
            <Switch checked={ignoreHours} onCheckedChange={setIgnoreHours} aria-label={t("pastoral.behalf.ignoreHours")} />
          </div>
        )}

        {!pastorId || !typeId ? (
          <p className="text-muted-foreground text-sm">{t("pastoral.slots.pickFirst")}</p>
        ) : ignoreHours ? (
          <div className="space-y-1.5">
            <Label htmlFor="bb-manual">{t("pastoral.behalf.startTime")}</Label>
            <Input id="bb-manual" type="datetime-local" step={300} value={manual} onChange={(e) => setManual(e.target.value)} />
          </div>
        ) : (
          <SlotPicker
            key={`${pastorId}:${typeId}`}
            load={(from) => listSlotsForStaff(pastorId, typeId, from)}
            initialFromDay={fromDay}
            value={startsAt}
            onChange={setStartsAt}
            emptyText={t("pastoral.public.noTimes", { days: 14 })}
            reloadKey={reloadKey}
          />
        )}

        {type?.location === "home" && (
          <div className="space-y-1.5">
            <Label htmlFor="bb-address">{t("pastoral.public.address")}</Label>
            <Input id="bb-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="bb-topic">{t("pastoral.public.topic")}</Label>
          <Textarea id="bb-topic" value={topic} maxLength={1000} onChange={(e) => setTopic(e.target.value)} />
          <p className="text-muted-foreground text-xs">{t("pastoral.public.topicPrivate")}</p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <p className="text-sm font-semibold">{t("pastoral.behalf.sendConfirmation")}</p>
          <Switch
            checked={sendConfirmation}
            onCheckedChange={setSendConfirmation}
            aria-label={t("pastoral.behalf.sendConfirmation")}
          />
        </div>

        {error && (
          <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={pending || !ready} onClick={submit}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("pastoral.behalf.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
