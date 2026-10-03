"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecord,
  attendanceSession,
  meeting,
  meetingParticipant,
} from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { can } from "@/lib/permissions";
import { isSfuConfigured } from "@/lib/sfu";
import { audit, diffFields, summariseChanges } from "@/lib/audit";
import {
  allocateMeetingCode,
  endMeeting as endMeetingRoom,
  generateHostKey,
  getMeeting,
  rollSeriesForward,
} from "@/lib/meetings";
import {
  describeRepeat,
  MEETING_REPEATS,
  type MeetingRepeat,
} from "@/lib/meeting-recurrence";
import {
  canRepeatMeetings,
  chooseTransport,
  generatePasscode,
  MEETING_KINDS,
  meetingLimitFor,
  type MeetingKind,
} from "@/lib/meetings-shared";

export type ActionResult =
  | { ok: true; id?: string; code?: string }
  | { ok: false; error: string };

const DENIED: ActionResult = {
  ok: false,
  error: "You don't have permission to manage meetings.",
};

/** Every write starts here: the church, and the right to change its meetings. */
async function guard() {
  const { church, user } = await requireChurch();
  if (!(await can("meetings.manage"))) return null;
  return {
    churchId: church.id,
    userId: user.id,
    timezone: church.timezone,
    // The plan decides how big a room may be, so every write that touches the
    // room limit needs it to hand.
    plan: church.plan,
  };
}

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const meetingSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Give the meeting a name").max(160),
  description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()),
  kind: z.enum(MEETING_KINDS as unknown as [MeetingKind, ...MeetingKind[]]),
  /** A local datetime from the browser, e.g. "2026-10-05T18:30". Blank = now. */
  scheduledFor: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a real date and time")
      .nullable(),
  ),
  durationMin: z.coerce.number().int().min(5).max(600).default(60),
  access: z.enum(["open", "passcode", "members"]),
  lobby: z.boolean().default(false),
  maxParticipants: z.coerce.number().int().min(2).max(1000).default(12),
  muteOnEntry: z.boolean().default(true),
  cameraOffOnEntry: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  allowReactions: z.boolean().default(true),
  allowScreenShare: z.boolean().default(true),
  allowRecording: z.boolean().default(true),
  lowDataDefault: z.boolean().default(false),
  /** "none" | "daily" | "weekly" | "fortnightly" | "monthly" | "monthly-weekday". */
  repeat: z
    .enum(MEETING_REPEATS as unknown as [MeetingRepeat, ...MeetingRepeat[]])
    .default("none"),
  /** A local date from the browser, e.g. "2027-03-31". Blank = no end. */
  repeatUntil: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a real date for the last one")
      .nullable(),
  ),
});

export type MeetingInput = z.input<typeof meetingSchema>;

function refresh(id?: string) {
  revalidatePath("/meetings");
  if (id) revalidatePath(`/meetings/${id}`);
}

/**
 * Create or update a meeting.
 *
 * A meeting's code is minted once and never changes: it is in WhatsApp
 * messages, on printed bulletins and in somebody's calendar by the time
 * anybody edits the title, and a link that stops working is worse than a
 * stale name.
 */
export async function saveMeeting(input: MeetingInput): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;

  const scheduledFor = v.scheduledFor ? new Date(v.scheduledFor) : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime()))
    return { ok: false, error: "Pick a real date and time." };

  /*
   * A repeat needs something to repeat from.
   *
   * "Every Wednesday" is read off the date it starts, so a repeating meeting
   * with no date is a rule with no anchor — it would silently become "every week
   * from whenever this was created", which is not what anybody meant by leaving
   * the box blank.
   */
  const repeat: MeetingRepeat = scheduledFor ? v.repeat : "none";
  if (v.repeat !== "none" && !scheduledFor)
    return { ok: false, error: "Pick a date and time first — a repeat starts from it." };

  /*
   * Repeating is a paid upgrade, checked on the server.
   *
   * The dialog already hides it on a plan that does not include it, but the form
   * came from a browser — and this is the only place the church's actual plan is
   * known for certain. Worded as what to do about it rather than as a refusal.
   */
  if (repeat !== "none" && !canRepeatMeetings(g.plan)) {
    return {
      ok: false,
      error:
        "Repeating meetings are on the Pro plan. Upgrade to set a meeting up once and have it run every week.",
    };
  }

  /*
   * The end date is the END of that day, not its first second. Somebody typing
   * the 31st means "including the 31st", and a 6pm meeting on the 31st is after
   * midnight on the 31st.
   */
  const repeatUntil = v.repeatUntil ? new Date(`${v.repeatUntil}T23:59:59`) : null;
  if (repeatUntil && Number.isNaN(repeatUntil.getTime()))
    return { ok: false, error: "Pick a real date for the last one." };
  if (repeatUntil && scheduledFor && repeatUntil.getTime() < scheduledFor.getTime())
    return { ok: false, error: "The last one cannot be before the first one." };

  /*
   * The plan's ceiling for one room. Checked here rather than trusted from the
   * form, because relayed media costs real money per gigabyte and the number
   * in the form came from a browser.
   */
  const ceiling = meetingLimitFor(g.plan);
  if (ceiling !== null && v.maxParticipants > ceiling) {
    return {
      ok: false,
      error: `Your plan allows up to ${ceiling} people in a meeting. Upgrade to hold a larger one.`,
    };
  }

  const values = {
    title: v.title,
    description: v.description,
    kind: v.kind,
    scheduledFor,
    durationMin: v.durationMin,
    access: v.access,
    lobby: v.lobby,
    maxParticipants: v.maxParticipants,
    muteOnEntry: v.muteOnEntry,
    cameraOffOnEntry: v.cameraOffOnEntry,
    allowChat: v.allowChat,
    allowReactions: v.allowReactions,
    allowScreenShare: v.allowScreenShare,
    allowRecording: v.allowRecording,
    lowDataDefault: v.lowDataDefault,
    repeat,
    repeatUntil,
    /*
     * Decided here, once, and never while people are in the room — everyone in
     * a meeting must use the same transport, because a mesh peer and an SFU
     * peer cannot see each other at all.
     *
     * Editing a meeting re-runs this, which is right: raising the room limit
     * before it starts should move it onto the SFU. `isJoinable` keeps that
     * from happening to a meeting already under way.
     */
    transport: chooseTransport({
      maxParticipants: v.maxParticipants,
      sfuAvailable: isSfuConfigured(),
    }),
  };

  if (v.id) {
    const existing = await getMeeting(v.id, g.churchId);
    if (!existing) return { ok: false, error: "We couldn't find that meeting." };

    // A passcode is minted when the access mode first needs one, and kept
    // afterwards so switching away and back does not lock out everyone who
    // already has it written down.
    const passcode =
      v.access === "passcode" ? (existing.passcode ?? generatePasscode()) : existing.passcode;

    /*
     * Re-anchor the rule when the date has actually moved, or when the repeat is
     * being switched on for the first time.
     *
     * The anchor is what "the 31st" and "the first Sunday" are read off. Moving
     * a repeating meeting to a Thursday is somebody saying the series happens on
     * Thursdays now, so the rule has to follow the date rather than stay pinned
     * to whatever it was first set up as. Left alone when nothing moved, so an
     * edit to the title cannot quietly re-anchor a monthly series.
     */
    const dateMoved =
      (existing.scheduledFor?.getTime() ?? null) !== (scheduledFor?.getTime() ?? null);
    const repeatAnchor =
      repeat === "none"
        ? existing.repeatAnchor
        : dateMoved || existing.repeat === "none"
          ? scheduledFor
          : (existing.repeatAnchor ?? scheduledFor);

    await db
      .update(meeting)
      .set({ ...values, passcode, repeatAnchor })
      .where(and(eq(meeting.id, v.id), eq(meeting.churchId, g.churchId)));

    const changed = diffFields(
      existing as unknown as Record<string, unknown>,
      values as unknown as Record<string, unknown>,
      Object.keys(values),
    );
    if (Object.keys(changed).length > 0) {
      await audit({
        churchId: g.churchId,
        action: "meetings.meeting.update",
        summary: `Changed ${summariseChanges(changed)} on the meeting "${v.title}"`,
        targetType: "meeting",
        targetId: v.id,
        targetLabel: v.title,
        meta: { changed },
      });
    }
    refresh(v.id);
    return { ok: true, id: v.id, code: existing.code };
  }

  const code = await allocateMeetingCode();
  const [row] = await db
    .insert(meeting)
    .values({
      ...values,
      churchId: g.churchId,
      code,
      passcode: v.access === "passcode" ? generatePasscode() : null,
      hostKey: generateHostKey(),
      hostUserId: g.userId,
      createdBy: g.userId,
      status: "scheduled",
      // The first occurrence IS the anchor, and carries the rule forward.
      repeatAnchor: repeat === "none" ? null : scheduledFor,
    })
    .returning({ id: meeting.id, code: meeting.code });

  const repeats = describeRepeat(repeat, scheduledFor, g.timezone);
  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.create",
    summary: scheduledFor
      ? `Scheduled the meeting "${v.title}" for ${scheduledFor.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: g.timezone })}${repeats ? ` — ${repeats.toLowerCase()}` : ""}`
      : `Created the meeting "${v.title}"`,
    targetType: "meeting",
    targetId: row.id,
    targetLabel: v.title,
    meta: { code: row.code, access: v.access, kind: v.kind },
  });

  refresh(row.id);
  return { ok: true, id: row.id, code: row.code };
}

/** Call off a meeting. The row stays — the history of it is the point. */
export async function cancelMeeting(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };
  if (m.status === "ended") return { ok: false, error: "That meeting has already ended." };

  await db
    .update(meeting)
    .set({ status: "cancelled" })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.cancel",
    summary: `Cancelled the meeting "${m.title}"`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    severity: "notice",
  });

  /*
   * Calling off one week is not calling off the series. A church that cancels
   * Wednesday because of a funeral still has Wednesday prayer next week, so the
   * next occurrence goes straight on the calendar — and `held: true`, because
   * somebody deliberately cancelling is the opposite of a series nobody is
   * looking after, and must not count towards it giving up.
   *
   * To stop the whole series there is "Stop repeating", which says so.
   */
  if (m.repeat !== "none") {
    try {
      await rollSeriesForward(id, { held: true });
    } catch (e) {
      console.error("[meetings] could not continue the series after cancelling", id, e);
    }
  }

  refresh(id);
  return { ok: true };
}

/**
 * Stop a series repeating, leaving this occurrence alone.
 *
 * The counterpart to Cancel: Cancel calls off one week and keeps the series,
 * this keeps the week and ends the series. Both are needed, and a single button
 * that did one of them would silently do the wrong one half the time.
 */
export async function stopRepeating(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };
  if (m.repeat === "none") return { ok: false, error: "That meeting doesn't repeat." };

  await db
    .update(meeting)
    .set({ repeat: "none", repeatUntil: null })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.update",
    summary: `Stopped "${m.title}" repeating`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    severity: "notice",
    meta: { was: m.repeat },
  });

  refresh(id);
  return { ok: true, id };
}

/** Put a cancelled meeting back on the calendar. */
export async function reopenMeeting(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  await db
    .update(meeting)
    .set({ status: "scheduled", endedAt: null })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.reopen",
    summary: `Put the meeting "${m.title}" back on`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
  });

  refresh(id);
  return { ok: true, id };
}

/** End a meeting from outside the room — when the host's laptop has gone. */
export async function endMeetingNow(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  await endMeetingRoom(id);
  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.end",
    summary: `Ended the meeting "${m.title}"`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    severity: "notice",
  });

  refresh(id);
  return { ok: true, id };
}

/**
 * Issue a new passcode. The old one stops working immediately, which is the
 * whole point — it is what you do when a link has gone somewhere it shouldn't.
 */
export async function rotatePasscode(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  await db
    .update(meeting)
    .set({ passcode: generatePasscode(), access: "passcode" })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.passcode.reset",
    summary: `Issued a new passcode for "${m.title}"`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    severity: "warning",
  });

  refresh(id);
  return { ok: true, id };
}

/**
 * Issue a new host link.
 *
 * The old one stops working at once — which is the point. A host link hands
 * whoever holds it the power to mute the room, put things on everyone's
 * screen and end the meeting, so there has to be a way to take it back.
 */
export async function rotateHostKey(
  id: string,
): Promise<ActionResult & { hostKey?: string }> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  const hostKey = generateHostKey();
  await db
    .update(meeting)
    .set({ hostKey })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.host_link.reset",
    summary: `Issued a new host link for "${m.title}" — the old one stopped working`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    severity: "warning",
  });

  refresh(id);
  return { ok: true, id, hostKey };
}

/**
 * Turn a meeting's register into an attendance record.
 *
 * Everyone who joined and is linked to a member is marked present; guests and
 * unlinked sign-ins are counted in the headcount but have no row to attach to.
 * The session is keyed to the meeting's own day, and re-running it updates the
 * same session rather than creating a second one — a host pressing the button
 * twice must not double the church's attendance for that Sunday.
 */
export async function recordAttendanceFromMeeting(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;
  if (!(await can("attendance.manage")))
    return { ok: false, error: "You don't have permission to record attendance." };

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  const people = await db
    .select({
      memberId: meetingParticipant.memberId,
      userId: meetingParticipant.userId,
      peerId: meetingParticipant.peerId,
    })
    .from(meetingParticipant)
    .where(
      and(
        eq(meetingParticipant.meetingId, id),
        eq(meetingParticipant.admitted, true),
        eq(meetingParticipant.removed, false),
      ),
    );

  if (people.length === 0)
    return { ok: false, error: "Nobody joined this meeting, so there's nothing to record." };

  // One person who dropped out and rejoined is one attendee, not two.
  const memberIds = [...new Set(people.map((p) => p.memberId).filter((x): x is string => !!x))];
  const distinctPeople = new Set(
    people.map((p) => p.memberId ?? p.userId ?? p.peerId),
  ).size;

  const when = m.startedAt ?? m.scheduledFor ?? new Date();
  const date = when.toISOString().slice(0, 10);

  const [session] = await db
    .insert(attendanceSession)
    .values({
      churchId: g.churchId,
      serviceId: m.serviceId,
      title: m.title,
      date,
      totalCount: distinctPeople,
      notes: `Recorded from the online meeting "${m.title}".`,
      recordedBy: g.userId,
    })
    .onConflictDoUpdate({
      target: [attendanceSession.churchId, attendanceSession.serviceId, attendanceSession.date],
      set: {
        totalCount: sql`greatest(${attendanceSession.totalCount}, ${distinctPeople})`,
        title: m.title,
      },
    })
    .returning({ id: attendanceSession.id });

  if (memberIds.length > 0) {
    await db
      .insert(attendanceRecord)
      .values(
        memberIds.map((memberId) => ({
          sessionId: session.id,
          memberId,
          status: "present" as const,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .update(meeting)
    .set({ recordAttendance: true })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  await audit({
    churchId: g.churchId,
    action: "meetings.attendance.create",
    summary: `Recorded ${distinctPeople} attendee${distinctPeople === 1 ? "" : "s"} from the meeting "${m.title}"`,
    targetType: "meeting",
    targetId: id,
    targetLabel: m.title,
    meta: { attendanceSessionId: session.id, members: memberIds.length, total: distinctPeople },
    severity: "notice",
  });

  revalidatePath("/attendance");
  refresh(id);
  return { ok: true, id: session.id };
}

/**
 * Meetings a host might reasonably re-run. Used by the "start again" shortcut,
 * which copies a finished meeting's settings into a fresh one — a weekly
 * prayer meeting is the same meeting every week apart from its link.
 */
export async function duplicateMeeting(id: string): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  const code = await allocateMeetingCode();
  const [row] = await db
    .insert(meeting)
    .values({
      churchId: g.churchId,
      code,
      title: m.title,
      description: m.description,
      kind: m.kind,
      durationMin: m.durationMin,
      access: m.access,
      passcode: m.access === "passcode" ? generatePasscode() : null,
      hostKey: generateHostKey(),
      lobby: m.lobby,
      maxParticipants: m.maxParticipants,
      muteOnEntry: m.muteOnEntry,
      cameraOffOnEntry: m.cameraOffOnEntry,
      allowChat: m.allowChat,
      allowReactions: m.allowReactions,
      allowScreenShare: m.allowScreenShare,
      allowRecording: m.allowRecording,
      lowDataDefault: m.lowDataDefault,
      serviceId: m.serviceId,
      groupId: m.groupId,
      hostUserId: g.userId,
      createdBy: g.userId,
      status: "scheduled",
    })
    .returning({ id: meeting.id, code: meeting.code });

  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.create",
    summary: `Started a new "${m.title}" from the last one`,
    targetType: "meeting",
    targetId: row.id,
    targetLabel: m.title,
    meta: { copiedFrom: id, code: row.code },
  });

  refresh(row.id);
  return { ok: true, id: row.id, code: row.code };
}

/**
 * Link a meeting to one of the church's services, so the attendance it
 * produces lands in the right place on the attendance page.
 */
export async function setMeetingService(
  id: string,
  serviceId: string | null,
): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;

  const m = await getMeeting(id, g.churchId);
  if (!m) return { ok: false, error: "We couldn't find that meeting." };

  await db
    .update(meeting)
    .set({ serviceId })
    .where(and(eq(meeting.id, id), eq(meeting.churchId, g.churchId)));

  refresh(id);
  return { ok: true, id };
}

/** Meetings this church has that are still live, for the "join" shortcut. */
export async function liveMeetingIds(): Promise<string[]> {
  const { church } = await requireChurch();
  if (!(await can("meetings.view"))) return [];
  const rows = await db
    .select({ id: meeting.id })
    .from(meeting)
    .where(
      and(
        eq(meeting.churchId, church.id),
        eq(meeting.status, "live"),
        isNotNull(meeting.startedAt),
      ),
    )
    .limit(20);
  return rows.map((r) => r.id);
}

/** Used by the list page to bulk-cancel a run of stale scheduled meetings. */
export async function cancelMany(ids: string[]): Promise<ActionResult> {
  // Every write in this module needs the plan that includes it. Reading
  // what is already here does not — see lib/entitlements.ts.
  const gate = await refuseWithoutFeature("meetings");
  if (gate) return gate;

  const g = await guard();
  if (!g) return DENIED;
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };

  const rows = await db
    .update(meeting)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(meeting.churchId, g.churchId),
        inArray(meeting.id, ids.slice(0, 100)),
        eq(meeting.status, "scheduled"),
      ),
    )
    .returning({ id: meeting.id, title: meeting.title });

  if (rows.length > 0) {
    await audit({
      churchId: g.churchId,
      action: "meetings.meeting.cancel",
      summary: `Cancelled ${rows.length} scheduled meeting${rows.length === 1 ? "" : "s"}`,
      targetType: "meeting",
      meta: { titles: rows.map((r) => r.title) },
      severity: "notice",
    });
  }

  refresh();
  return { ok: true };
}
