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
import { can } from "@/lib/permissions";
import { audit, diffFields, summariseChanges } from "@/lib/audit";
import {
  allocateMeetingCode,
  endMeeting as endMeetingRoom,
  generateHostKey,
  getMeeting,
} from "@/lib/meetings";
import {
  generatePasscode,
  MEETING_KINDS,
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
  return { churchId: church.id, userId: user.id, timezone: church.timezone };
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
  maxParticipants: z.coerce.number().int().min(2).max(30).default(12),
  muteOnEntry: z.boolean().default(true),
  cameraOffOnEntry: z.boolean().default(false),
  allowChat: z.boolean().default(true),
  allowReactions: z.boolean().default(true),
  allowScreenShare: z.boolean().default(true),
  allowRecording: z.boolean().default(true),
  lowDataDefault: z.boolean().default(false),
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
  const g = await guard();
  if (!g) return DENIED;

  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;

  const scheduledFor = v.scheduledFor ? new Date(v.scheduledFor) : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime()))
    return { ok: false, error: "Pick a real date and time." };

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
  };

  if (v.id) {
    const existing = await getMeeting(v.id, g.churchId);
    if (!existing) return { ok: false, error: "We couldn't find that meeting." };

    // A passcode is minted when the access mode first needs one, and kept
    // afterwards so switching away and back does not lock out everyone who
    // already has it written down.
    const passcode =
      v.access === "passcode" ? (existing.passcode ?? generatePasscode()) : existing.passcode;

    await db
      .update(meeting)
      .set({ ...values, passcode })
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
    })
    .returning({ id: meeting.id, code: meeting.code });

  await audit({
    churchId: g.churchId,
    action: "meetings.meeting.create",
    summary: scheduledFor
      ? `Scheduled the meeting "${v.title}" for ${scheduledFor.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
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

  refresh(id);
  return { ok: true, id };
}

/** Put a cancelled meeting back on the calendar. */
export async function reopenMeeting(id: string): Promise<ActionResult> {
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
