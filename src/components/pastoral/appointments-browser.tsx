"use client";

import { useState } from "react";
import { CalendarClock, Clock, ListChecks, Plus, Settings2, Tags, Globe2, UserRound, Users } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { weekdayNames } from "@/lib/i18n/formatting";
import type { CalendarEntry } from "@/lib/facilities";
import { holdsTheSlot, statusMeta, type WeeklyWindow } from "@/lib/pastoral-shared";
import { dayKeyIn, daysCovered } from "@/lib/calendar-days";
import {
  FacilityCalendar,
  type CalendarLabels,
  type CalendarTone,
} from "@/components/facilities/facility-calendar";
import { DayAgenda } from "@/components/pastoral/day-agenda";
import { AppointmentSheet } from "@/components/pastoral/appointment-sheet";
import { BookOnBehalfDialog } from "@/components/pastoral/book-on-behalf-dialog";
import { AvailabilityEditor } from "@/components/pastoral/availability-editor";
import { BookingTypesEditor } from "@/components/pastoral/booking-types-editor";
import { BookingPageCard } from "@/components/pastoral/booking-page-card";

/* The shapes the server page hands down. Dates are ISO strings. */

export type PastorItem = {
  id: string;
  userId: string;
  displayName: string;
  title: string | null;
  isBookable: boolean;
  onTeam: boolean;
  typeIds: string[];
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  hours: WeeklyWindow[];
  pending: number;
};

export type AppointmentItem = {
  id: string;
  pastorId: string | null;
  pastorName: string;
  typeId: string | null;
  typeName: string;
  location: string;
  address: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  memberId: string | null;
  memberName: string | null;
  identityVerified: boolean;
  bookerName: string;
  bookerPhone: string | null;
  bookerEmail: string | null;
  /** Null unless this viewer is the pastor or manages every diary. */
  topic: string | null;
  topicHidden: boolean;
  decisionNote: string | null;
  confirmationOutcome: string | null;
  reminderOutcome: string | null;
  remindAt: string | null;
  reminderSentAt: string | null;
  rescheduledFrom: string | null;
  rescheduleCount: number;
  outsideHours: boolean;
};

export type ClosureItem = {
  id: string;
  pastorId: string;
  kind: string;
  reason: string;
  startsAt: string;
  endsAt: string;
};

export type TypeItem = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  location: string;
  requiresApproval: boolean;
  isActive: boolean;
  pastorIds: string[];
};

export type PageItem = {
  slug: string;
  url: string;
  enabled: boolean;
  visibility: "public" | "members";
  title: string;
  intro: string;
  emailBooker: boolean;
  smsBooker: boolean;
  notifyPastorByEmail: boolean;
  reminderLeadMinutes: number;
  changeCutoffHours: number;
  maxUpcomingPerContact: number;
};

export type MemberOption = { id: string; name: string };
export type TeamOption = { userId: string; name: string };

type Tab = "diary" | "all" | "requests" | "availability" | "types" | "page";

/**
 * The /appointments page, below its header.
 *
 * A pastor lands on their own diary; somebody with the module but no diary
 * of their own lands on everybody's. Managers also get the booking types and
 * the public page. Every overlay here is a Radix dialog, which portals to
 * <body>, so the blurred app header cannot trap a fixed panel (AGENTS.md).
 */
export function AppointmentsBrowser(props: {
  meUserId: string;
  myPastorId: string | null;
  canManage: boolean;
  canAddToRegister: boolean;
  zone: string;
  today: string;
  pastors: PastorItem[];
  appointments: AppointmentItem[];
  closures: ClosureItem[];
  types: TypeItem[];
  page: PageItem | null;
  secretMissing: boolean;
  team: TeamOption[];
  members: MemberOption[];
}) {
  const { myPastorId, canManage, zone, pastors, appointments, closures, types } = props;
  const t = useT();
  const [tab, setTab] = useState<Tab>(myPastorId ? "diary" : "all");
  const [filter, setFilter] = useState<string>("everyone");
  const [day, setDay] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ day?: string } | null>(null);
  const [bookSeq, setBookSeq] = useState(0);

  const me = pastors.find((p) => p.id === myPastorId) ?? null;
  const pendingMine = appointments.filter(
    (a) => a.status === "pending" && (canManage || (myPastorId && a.pastorId === myPastorId)),
  );
  const activeTypes = types.filter((ty) => ty.isActive);
  const canBook = pastors.some((p) => p.onTeam) && activeTypes.length > 0;

  /** Whose appointments the calendar shows on this tab. */
  const scopePastorId = tab === "diary" ? myPastorId : filter === "everyone" ? null : filter;
  const inScope = <T extends { pastorId: string | null }>(x: T) => !scopePastorId || x.pastorId === scopePastorId;

  const entries: CalendarEntry[] = [
      ...appointments
        .filter((a) => holdsTheSlot(a.status) && inScope(a))
        .map((a) => ({
          id: a.id,
          kind: "booking" as const,
          facilityId: a.pastorId ?? "",
          facilityName: a.pastorName,
          title: scopePastorId ? `${a.typeName} · ${a.bookerName}` : `${a.pastorName}: ${a.typeName}`,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          status: a.status,
        })),
      ...closures.filter(inScope).map((c) => ({
        id: c.id,
        kind: "closure" as const,
        facilityId: c.pastorId,
        facilityName: pastors.find((p) => p.id === c.pastorId)?.displayName ?? "",
        title: c.reason,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        status: c.kind,
      })),
  ];

  const tone = (e: CalendarEntry): CalendarTone =>
    e.kind === "closure" ? "closed" : e.status === "confirmed" ? "held" : "pending";

  const sundayFirst = weekdayNames(t.locale, "short");
  const labels: CalendarLabels = {
    weekdays: [...sundayFirst.slice(1), sundayFirst[0]],
    today: t("pastoral.calendar.today"),
    more: (n) => t("pastoral.calendar.more", { count: n }),
    prev: t("pastoral.calendar.prev"),
    next: t("pastoral.calendar.next"),
    legend: {
      held: t("pastoral.legend.held"),
      pending: t("pastoral.legend.pending"),
      closed: t("pastoral.legend.closed"),
    },
  };

  const nowIso = new Date().toISOString();
  const upcoming = appointments
    .filter((a) => holdsTheSlot(a.status) && a.endsAt >= nowIso && inScope(a))
    .slice(0, 25);
  const outsideMine = me
    ? appointments.filter((a) => a.pastorId === me.id && holdsTheSlot(a.status) && a.endsAt >= nowIso && a.outsideHours).length
    : 0;

  const open = appointments.find((a) => a.id === openId) ?? null;

  const tabs: { key: Tab; label: string; icon: typeof Clock; badge?: number }[] = [
    ...(myPastorId ? [{ key: "diary" as const, label: t("pastoral.tabs.diary"), icon: UserRound }] : []),
    { key: "all", label: t("pastoral.tabs.all"), icon: Users },
    { key: "requests", label: t("pastoral.tabs.requests"), icon: ListChecks, badge: pendingMine.length },
    ...(canManage || myPastorId
      ? [{ key: "availability" as const, label: t("pastoral.tabs.availability"), icon: Settings2 }]
      : []),
    ...(canManage
      ? [
          { key: "types" as const, label: t("pastoral.tabs.types"), icon: Tags },
          { key: "page" as const, label: t("pastoral.tabs.page"), icon: Globe2 },
        ]
      : []),
  ];

  const fmtWhen = (iso: string) =>
    new Intl.DateTimeFormat(t.intl, {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  const openBooking = (preset: { day?: string }) => {
    setBookSeq((n) => n + 1);
    setBooking(preset);
  };

  const row = (a: AppointmentItem) => {
    const meta = statusMeta(a.status);
    return (
      <li key={a.id}>
        <button
          type="button"
          onClick={() => setOpenId(a.id)}
          className="hover:bg-muted/60 flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              {a.typeName} · {a.bookerName}
            </span>
            <span className="text-muted-foreground block text-xs">
              {fmtWhen(a.startsAt)}
              {!scopePastorId ? ` · ${a.pastorName}` : ""}
            </span>
          </span>
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", meta.className)}>{t(meta.labelKey)}</span>
          {a.outsideHours && holdsTheSlot(a.status) && (
            <Badge variant="outline">{t("pastoral.sheet.outsideHours")}</Badge>
          )}
        </button>
      </li>
    );
  };

  const diaryView = (
    <div className="space-y-5">
      {tab === "diary" && me && me.hours.length === 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">{t("pastoral.empty.noHours")}</p>
      )}
      {tab === "diary" && outsideMine > 0 && (
        <p className="text-muted-foreground rounded-xl border px-4 py-3 text-sm">
          {t("pastoral.ui.outsideCount", { count: outsideMine })}
        </p>
      )}
      {tab === "all" && !myPastorId && pastors.length > 0 && (
        <p className="text-muted-foreground text-sm">{t("pastoral.empty.notAPastor")}</p>
      )}
      {tab === "all" && pastors.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
          {t("pastoral.empty.noPastors")}
        </p>
      )}
      {tab === "all" && pastors.length > 1 && (
        <div className="max-w-xs space-y-1.5">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full" aria-label={t("pastoral.ui.pastor")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">{t("pastoral.ui.everyone")}</SelectItem>
              {pastors.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <FacilityCalendar entries={entries} onPick={(d) => setDay(d)} timeZone={zone} tone={tone} labels={labels} />

      <Card>
        <CardContent className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-bold">
            <CalendarClock className="size-4" /> {t("pastoral.ui.comingUp")}
          </p>
          {upcoming.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tab === "diary" ? t("pastoral.empty.diary") : t("pastoral.ui.nothingComingUp")}
            </p>
          ) : (
            <ul className="divide-y">{upcoming.map(row)}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // The day agenda reads the same scope as the calendar it was opened from.
  const dayItems = day
    ? appointments.filter(
        (a) => holdsTheSlot(a.status) && inScope(a) && daysCovered(a.startsAt, a.endsAt, zone).includes(day),
      )
    : [];
  const dayClosures = day
    ? closures.filter((c) => inScope(c) && daysCovered(c.startsAt, c.endsAt, zone).includes(day))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted -mx-1 flex max-w-full gap-1 overflow-x-auto rounded-xl p-1">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition",
                tab === key ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
              {badge ? (
                <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{badge}</span>
              ) : null}
            </button>
          ))}
        </div>
        {canBook && (
          <Button size="sm" className="ml-auto min-h-11" onClick={() => openBooking({})}>
            <Plus className="size-4" /> {t("pastoral.actions.bookOnBehalf")}
          </Button>
        )}
      </div>

      {(tab === "diary" || tab === "all") && diaryView}

      {tab === "requests" &&
        (pendingMine.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
            {t("pastoral.empty.noRequests")}
          </p>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y">{pendingMine.map(row)}</ul>
            </CardContent>
          </Card>
        ))}

      {tab === "availability" && (
        <AvailabilityEditor
          pastors={canManage ? pastors : pastors.filter((p) => p.id === myPastorId)}
          defaultPastorId={myPastorId ?? pastors[0]?.id ?? null}
          closures={closures}
          zone={zone}
          today={props.today}
          canManage={canManage}
          team={props.team}
          types={types}
        />
      )}

      {tab === "types" && canManage && <BookingTypesEditor types={types} pastors={pastors} />}

      {tab === "page" && canManage && props.page && (
        <BookingPageCard page={props.page} secretMissing={props.secretMissing} />
      )}

      <DayAgenda
        day={day}
        zone={zone}
        appointments={dayItems}
        closures={dayClosures}
        pastors={pastors}
        onClose={() => setDay(null)}
        onOpen={(id) => {
          setDay(null);
          setOpenId(id);
        }}
        onBook={
          canBook && day && day >= dayKeyIn(new Date(), zone)
            ? () => {
                const d = day;
                setDay(null);
                openBooking({ day: d });
              }
            : undefined
        }
      />

      <AppointmentSheet
        appointment={open}
        zone={zone}
        today={props.today}
        canAct={!!open && (canManage || (!!myPastorId && open.pastorId === myPastorId))}
        canManage={canManage}
        canAddToRegister={props.canAddToRegister}
        onClose={() => setOpenId(null)}
      />

      {booking && (
        <BookOnBehalfDialog
          key={bookSeq}
          open
          onOpenChange={(o) => !o && setBooking(null)}
          pastors={pastors.filter((p) => p.onTeam)}
          types={activeTypes}
          members={props.members}
          zone={zone}
          fromDay={booking.day && booking.day >= props.today ? booking.day : props.today}
          canManage={canManage}
          defaultPastorId={tab === "diary" ? myPastorId : scopePastorId}
        />
      )}
    </div>
  );
}
