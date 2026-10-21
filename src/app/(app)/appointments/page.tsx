import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, staff, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeature } from "@/lib/entitlements-server";
import { getT } from "@/lib/i18n/server";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { PlanGate } from "@/components/app/plan-gate";
import { Badge } from "@/components/ui/badge";
import {
  bookingUrl,
  ensureBookingPage,
  getBookingPage,
  listAppointments,
  listClosures,
  listHours,
  listPastors,
  listTypes,
  pendingCounts,
} from "@/lib/pastoral";
import { canSeeTopic, churchZone, type WeeklyWindow } from "@/lib/pastoral-shared";
import { fitsHours, todayKey } from "@/lib/pastoral-slots";
import { memberTicketSecret } from "@/lib/pastoral-tokens";
import {
  AppointmentsBrowser,
  type AppointmentItem,
  type ClosureItem,
  type PageItem,
  type PastorItem,
  type TypeItem,
} from "@/components/pastoral/appointments-browser";

/** Always current: a booking made on a phone should be there on the next load. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("pastoral.title") };
}

/**
 * Pastoral appointments: each pastor's diary, the requests waiting on them,
 * and (for managers) hours, types and the public booking page.
 *
 * Growth. `PlanGate` marks the page for a church below it and every write is
 * refused on the server; what is already here stays readable.
 *
 * What an appointment is ABOUT is stripped here, on the server, for anybody
 * who is neither that appointment's pastor nor a manager of every diary. It
 * never reaches their browser, so no client bug can show it.
 */
export default async function AppointmentsPage() {
  const { church, user: me } = await requireChurch();
  await requireCan("pastoral.view");
  const t = await getT();
  const [canManage, canFollowUpPerm, followUpOnPlan] = await Promise.all([
    can("pastoral.manage"),
    can("followup.manage"),
    hasFeature("followUp"),
  ]);

  const zone = churchZone(church);
  const now = new Date();
  // Three months either side, like Facilities: paging feels instant, and a
  // church with years of appointments is not sending all of them to a phone.
  const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 4, 1);

  const page = canManage
    ? await ensureBookingPage({ id: church.id, name: church.name, handle: church.handle })
    : await getBookingPage(church.id);

  const [pastors, recent, waiting, closures, types, pending] = await Promise.all([
    listPastors(church.id),
    listAppointments(church.id, { from, to, limit: 2000 }),
    // Every request still waiting, however far out: it must never fall off a list.
    listAppointments(church.id, { statuses: ["pending"], limit: 2000 }),
    listClosures(church.id, { from, to }),
    listTypes(church.id),
    pendingCounts(church.id),
  ]);
  const hours = await listHours(church.id, pastors.map((p) => p.id));

  const hoursBy = new Map<string, WeeklyWindow[]>();
  for (const h of hours) {
    const list = hoursBy.get(h.pastorId) ?? [];
    list.push({ weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute });
    hoursBy.set(h.pastorId, list);
  }
  const pastorOfUser = new Map(pastors.map((p) => [p.id, p.userId]));
  const mine = pastors.find((p) => p.userId === me.id) ?? null;

  const seen = new Set<string>();
  const rows = [...waiting, ...recent].filter((r) => (seen.has(r.a.id) ? false : (seen.add(r.a.id), true)));

  const appointments: AppointmentItem[] = rows
    .map(({ a, memberFirstName, memberLastName }) => {
      const showTopic = canSeeTopic({
        isThePastor: !!a.pastorId && pastorOfUser.get(a.pastorId) === me.id,
        canManage,
      });
      return {
        id: a.id,
        pastorId: a.pastorId,
        pastorName: a.pastorName,
        typeId: a.typeId,
        typeName: a.typeName,
        location: a.location,
        address: a.address,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        status: a.status,
        source: a.source,
        memberId: a.memberId,
        memberName: [memberFirstName, memberLastName].filter(Boolean).join(" ") || null,
        identityVerified: a.identityVerified,
        bookerName: a.bookerName,
        bookerPhone: a.bookerPhone,
        bookerEmail: a.bookerEmail,
        topic: showTopic ? a.topic : null,
        topicHidden: !showTopic && !!a.topic,
        decisionNote: a.decisionNote,
        confirmationOutcome: a.confirmationOutcome,
        reminderOutcome: a.reminderOutcome,
        remindAt: a.remindAt?.toISOString() ?? null,
        reminderSentAt: a.reminderSentAt?.toISOString() ?? null,
        rescheduledFrom: a.rescheduledFrom?.toISOString() ?? null,
        rescheduleCount: a.rescheduleCount,
        outsideHours:
          !!a.pastorId && !fitsHours(a.startsAt, a.endsAt, hoursBy.get(a.pastorId) ?? [], zone),
      };
    })
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt));

  const pastorItems: PastorItem[] = pastors.map((p) => ({
    id: p.id,
    userId: p.userId,
    displayName: p.displayName,
    title: p.title,
    isBookable: p.isBookable,
    onTeam: p.onTeam,
    typeIds: p.typeIds,
    slotMinutes: p.slotMinutes,
    bufferMinutes: p.bufferMinutes,
    minNoticeHours: p.minNoticeHours,
    maxAdvanceDays: p.maxAdvanceDays,
    hours: hoursBy.get(p.id) ?? [],
    pending: pending.get(p.id) ?? 0,
  }));

  const closureItems: ClosureItem[] = closures.map((c) => ({
    id: c.id,
    pastorId: c.pastorId,
    kind: c.kind,
    reason: c.reason,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
  }));

  const typeItems: TypeItem[] = types.map((ty) => ({
    id: ty.id,
    name: ty.name,
    description: ty.description,
    durationMinutes: ty.durationMinutes,
    location: ty.location,
    requiresApproval: ty.requiresApproval,
    isActive: ty.isActive,
    pastorIds: pastors.filter((p) => p.typeIds.includes(ty.id)).map((p) => p.id),
  }));

  const pageItem: PageItem | null = page
    ? {
        slug: page.slug,
        url: bookingUrl(page.slug),
        enabled: page.enabled,
        visibility: page.visibility,
        title: page.title,
        intro: page.intro,
        emailBooker: page.emailBooker,
        smsBooker: page.smsBooker,
        notifyPastorByEmail: page.notifyPastorByEmail,
        reminderLeadMinutes: page.reminderLeadMinutes,
        changeCutoffHours: page.changeCutoffHours,
        maxUpcomingPerContact: page.maxUpcomingPerContact,
      }
    : null;

  // Only managers add pastors, so only they need the team list.
  const team = canManage
    ? await db
        .selectDistinct({ userId: staff.userId, name: user.name })
        .from(staff)
        .innerJoin(user, eq(user.id, staff.userId))
        .where(and(eq(staff.organizationId, church.id), eq(staff.temp, false)))
        .orderBy(asc(user.name))
    : [];

  const memberRows = await db
    .select({ id: member.id, firstName: member.firstName, lastName: member.lastName })
    .from(member)
    .where(and(eq(member.churchId, church.id), eq(member.status, "active")))
    .orderBy(asc(member.firstName), asc(member.lastName))
    .limit(5000);

  return (
    <PageContainer>
      <PlanGate feature="pastoralBooking" />
      <PageHeader
        title={t("pastoral.title")}
        description={t("pastoral.subtitle")}
        badge={<Badge variant="secondary">{t("common.beta")}</Badge>}
      />
      <AppointmentsBrowser
        meUserId={me.id}
        myPastorId={mine?.id ?? null}
        canManage={canManage}
        canAddToRegister={canFollowUpPerm && followUpOnPlan}
        zone={zone}
        today={todayKey(now, zone)}
        pastors={pastorItems}
        appointments={appointments}
        closures={closureItems}
        types={typeItems}
        page={pageItem}
        secretMissing={!memberTicketSecret()}
        team={team.filter((m) => !pastors.some((p) => p.userId === m.userId))}
        members={memberRows.map((m) => ({
          id: m.id,
          name: [m.firstName, m.lastName].filter(Boolean).join(" "),
        }))}
      />
    </PageContainer>
  );
}
