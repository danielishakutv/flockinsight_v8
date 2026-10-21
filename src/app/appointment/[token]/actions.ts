"use server";

import { auditGuest } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";
import { isRealCalendarDate } from "@/lib/calendar-date";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  getAppointmentByToken,
  getType,
  hoursOf,
  listPastors,
  manageUrl,
  moveAppointment,
  openSlots,
  rulesFor,
  setStatus,
  type TokenAppointment,
} from "@/lib/pastoral";
import { afterCancel, afterReschedule } from "@/lib/pastoral-notify";
import { formatWhen, remindAtFor } from "@/lib/pastoral-messages";
import {
  HOLDING_STATUSES,
  MAX_SELF_RESCHEDULES,
  MAX_SLOT_WINDOW_DAYS,
  churchZone,
  holdsTheSlot,
  type AppointmentStatus,
} from "@/lib/pastoral-shared";
import { addDaysToKey, todayKey, type Slot } from "@/lib/pastoral-slots";
import { hashToken, newManageToken } from "@/lib/pastoral-tokens";

/**
 * What a manage link can do: cancel, or move to another open time.
 *
 * Viewing the page never acts. Mail scanners (Outlook Safe Links and the
 * like) open every link in an email, so a GET that cancelled would cancel
 * appointments nobody meant to touch. These are server actions, POSTs, which
 * Next.js origin-checks. Each one re-reads the appointment by its token, so a
 * link replaced by a move or a later message simply stops working.
 */

const HOUR = 60 * 60_000;

export type ManageError = {
  ok: false;
  error: string;
  code?: "expired" | "tooLate" | "changed" | "movedLimit" | "callChurch";
  taken?: boolean;
  slots?: Slot[];
};

type Loaded = { ok: true; found: TokenAppointment; t: TFunction } | ManageError;

async function load(token: string): Promise<Loaded> {
  const t = await getT();
  if (!rateLimit(`appt:${await clientIp()}`, 30, HOUR).ok) return { ok: false, error: t("pastoral.public.tooMany") };
  const found = typeof token === "string" ? await getAppointmentByToken(token) : null;
  if (!found || found.appt.endsAt.getTime() < Date.now())
    return { ok: false, error: t("pastoral.manage.expired"), code: "expired" };
  return { ok: true, found, t };
}

/** Still holding a slot, and further off than the church's cut-off. */
function changeRefusal(found: TokenAppointment, t: TFunction): ManageError | null {
  const a = found.appt;
  if (!holdsTheSlot(a.status))
    return {
      ok: false,
      error: t(a.status === "declined" ? "pastoral.manage.declined" : "pastoral.manage.cancelled"),
      code: "changed",
    };
  const hours = found.page?.changeCutoffHours ?? 2;
  if (a.startsAt.getTime() - hours * HOUR <= Date.now()) {
    const phone = found.church.publicPhone;
    return {
      ok: false,
      error: phone
        ? t("pastoral.manage.tooLate", { hours, phone })
        : t("pastoral.manage.tooLateNoPhone", { hours }),
      code: "tooLate",
    };
  }
  return null;
}

export async function cancelByToken(token: string, reason?: string): Promise<{ ok: true } | ManageError> {
  const loaded = await load(token);
  if (!loaded.ok) return loaded;
  const { found, t } = loaded;
  const refused = changeRefusal(found, t);
  if (refused) return refused;

  const note = (typeof reason === "string" ? reason : "").trim().slice(0, 300) || null;
  const row = await setStatus({
    id: found.appt.id,
    churchId: found.church.id,
    from: [...HOLDING_STATUSES] as AppointmentStatus[],
    to: "cancelled",
    patch: { cancelledBy: "booker", cancelledAt: new Date(), decisionNote: note, remindAt: null },
    expectStartsAt: found.appt.startsAt,
  });
  if (!row) return { ok: false, error: t("pastoral.manage.changed"), code: "changed" };

  await afterCancel(found.church.id, row.id, "booker");
  await auditGuest({
    churchId: found.church.id,
    guestName: row.bookerName,
    action: "pastoral.appointment.cancel",
    summary: `Cancelled ${row.typeName} with ${row.pastorName} for ${formatWhen(row.startsAt, churchZone(found.church), "en-GB")} from their link`,
    targetType: "pastoral_appointment",
    targetId: row.id,
  });
  return { ok: true };
}

/** The pastor, type and rules a move would use, or why it cannot happen online. */
async function moveContext(found: TokenAppointment, t: TFunction) {
  const a = found.appt;
  if (!a.pastorId || !a.typeId) return { ok: false as const, error: t("pastoral.manage.callChurch"), code: "callChurch" as const };
  const pastor = (await listPastors(found.church.id, { bookableOnly: true })).find((p) => p.id === a.pastorId);
  const type = await getType(found.church.id, a.typeId);
  if (!pastor || !type || !type.isActive)
    return { ok: false as const, error: t("pastoral.manage.callChurch"), code: "callChurch" as const };
  const zone = churchZone(found.church);
  const length = Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
  const rules = rulesFor(pastor, await hoursOf(found.church.id, pastor.id), { durationMinutes: length }, zone);
  return { ok: true as const, pastor, type, zone, rules };
}

export async function listSlotsForToken(
  token: string,
  fromDay: string,
): Promise<{ ok: true; zone: string; slots: Slot[]; nextFromDay: string } | ManageError> {
  const loaded = await load(token);
  if (!loaded.ok) return loaded;
  const { found, t } = loaded;
  const refused = changeRefusal(found, t);
  if (refused) return refused;
  const ctx = await moveContext(found, t);
  if (!ctx.ok) return ctx;
  const day = isRealCalendarDate(fromDay) ? fromDay : todayKey(new Date(), ctx.zone);
  const slots = await openSlots({
    churchId: found.church.id,
    pastorId: ctx.pastor.id,
    rules: ctx.rules,
    fromDay: day,
    days: MAX_SLOT_WINDOW_DAYS,
    now: new Date(),
    ignoreId: found.appt.id,
  });
  return { ok: true, zone: ctx.zone, slots, nextFromDay: addDaysToKey(day, MAX_SLOT_WINDOW_DAYS) };
}

/**
 * Move to another open time. A new link replaces this one (the response
 * carries it, and the page moves to it), and the status goes back to pending
 * when the type needs the pastor to confirm.
 */
export async function rescheduleByToken(
  token: string,
  startsAt: string,
): Promise<{ ok: true; manageUrl: string } | ManageError> {
  const loaded = await load(token);
  if (!loaded.ok) return loaded;
  const { found, t } = loaded;
  const refused = changeRefusal(found, t);
  if (refused) return refused;
  if (found.appt.rescheduleCount >= MAX_SELF_RESCHEDULES)
    return { ok: false, error: t("pastoral.manage.movedLimit"), code: "movedLimit" };
  const ctx = await moveContext(found, t);
  if (!ctx.ok) return ctx;

  const newToken = newManageToken();
  const now = new Date();
  const lead = found.page?.reminderLeadMinutes ?? 1440;
  const moved = await moveAppointment({
    id: found.appt.id,
    churchId: found.church.id,
    pastorId: ctx.pastor.id,
    rules: ctx.rules,
    expectStartsAt: found.appt.startsAt,
    newStartsAt: String(startsAt ?? ""),
    now,
    newTokenHash: hashToken(newToken),
    newStatus: ctx.type.requiresApproval ? "pending" : "confirmed",
    remindAt: (slot) => remindAtFor(new Date(slot.startsAt), lead, ctx.zone, now),
  });
  if (!moved.ok) {
    if (moved.reason === "taken") {
      const at = new Date(String(startsAt ?? ""));
      const day = Number.isNaN(at.getTime()) ? todayKey(now, ctx.zone) : todayKey(at, ctx.zone);
      const slots = await openSlots({
        churchId: found.church.id,
        pastorId: ctx.pastor.id,
        rules: ctx.rules,
        fromDay: day,
        days: MAX_SLOT_WINDOW_DAYS,
        now,
        ignoreId: found.appt.id,
      });
      return { ok: false, error: t("pastoral.public.taken"), taken: true, slots };
    }
    if (moved.reason === "missing") return { ok: false, error: t("pastoral.manage.callChurch"), code: "callChurch" };
    return { ok: false, error: t("pastoral.manage.changed"), code: "changed" };
  }

  await afterReschedule(found.church.id, found.appt.id, { token: newToken, toBooker: true, now });
  await auditGuest({
    churchId: found.church.id,
    guestName: found.appt.bookerName,
    action: "pastoral.appointment.reschedule",
    summary: `Moved ${found.appt.typeName} with ${found.appt.pastorName} from ${formatWhen(found.appt.startsAt, ctx.zone, "en-GB")} to ${formatWhen(moved.slot.startsAt, ctx.zone, "en-GB")} from their link`,
    targetType: "pastoral_appointment",
    targetId: found.appt.id,
  });
  return { ok: true, manageUrl: manageUrl(newToken) };
}
