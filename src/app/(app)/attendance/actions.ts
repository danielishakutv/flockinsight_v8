"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceSession } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

const count = z.number().int().min(0).max(1_000_000);

const recordSchema = z.object({
  id: z.string().uuid().optional(),
  serviceId: z.string().uuid().nullable(),
  title: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  // Adults by gender.
  maleCount: count,
  femaleCount: count,
  // Teens by gender.
  teenMaleCount: count,
  teenFemaleCount: count,
  // Children / first-timers / converts by gender. The totals are sent by the
  // form too: for rows recorded before the split they carry the legacy value
  // (splits untouched at 0), otherwise they equal the split sum.
  childMaleCount: count,
  childFemaleCount: count,
  childrenCount: count,
  firstTimerMaleCount: count,
  firstTimerFemaleCount: count,
  firstTimerCount: count,
  newConvertMaleCount: count,
  newConvertFemaleCount: count,
  newConvertCount: count,
  notes: z.string().trim().max(1000).optional(),
});

export type RecordAttendanceInput = z.infer<typeof recordSchema>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function recordAttendance(
  input: RecordAttendanceInput,
): Promise<ActionResult> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  const d = parsed.data;

  const { church, user } = await requireChurch();
  if (!(await can("attendance.manage")))
    return { ok: false, error: "You don't have permission to record attendance." };

  if (!d.serviceId && !d.title) {
    return { ok: false, error: "Pick a service or name the event." };
  }

  // A gender split always wins over the accompanying total; the total only
  // stands on its own for legacy rows recorded before the split existed.
  const children =
    d.childMaleCount + d.childFemaleCount > 0
      ? d.childMaleCount + d.childFemaleCount
      : d.childrenCount;
  const firstTimers =
    d.firstTimerMaleCount + d.firstTimerFemaleCount > 0
      ? d.firstTimerMaleCount + d.firstTimerFemaleCount
      : d.firstTimerCount;
  const newConverts =
    d.newConvertMaleCount + d.newConvertFemaleCount > 0
      ? d.newConvertMaleCount + d.newConvertFemaleCount
      : d.newConvertCount;
  const total =
    d.maleCount + d.femaleCount + d.teenMaleCount + d.teenFemaleCount + children;

  const values = {
    churchId: church.id,
    serviceId: d.serviceId,
    title: d.serviceId ? null : (d.title || "Event"),
    date: d.date,
    maleCount: d.maleCount,
    femaleCount: d.femaleCount,
    teenMaleCount: d.teenMaleCount,
    teenFemaleCount: d.teenFemaleCount,
    childMaleCount: d.childMaleCount,
    childFemaleCount: d.childFemaleCount,
    childrenCount: children,
    firstTimerMaleCount: d.firstTimerMaleCount,
    firstTimerFemaleCount: d.firstTimerFemaleCount,
    firstTimerCount: firstTimers,
    newConvertMaleCount: d.newConvertMaleCount,
    newConvertFemaleCount: d.newConvertFemaleCount,
    newConvertCount: newConverts,
    totalCount: total,
    notes: d.notes || null,
    recordedBy: user.id,
    updatedAt: new Date(),
  };

  try {
    let row;
    if (d.id) {
      // Editing an existing session (must belong to this church).
      [row] = await db
        .update(attendanceSession)
        .set(values)
        .where(
          and(
            eq(attendanceSession.id, d.id),
            eq(attendanceSession.churchId, church.id),
          ),
        )
        .returning({ id: attendanceSession.id });
      if (!row) return { ok: false, error: "Session not found." };
    } else if (d.serviceId) {
      // Service-based: one per (church, service, date) — upsert.
      [row] = await db
        .insert(attendanceSession)
        .values(values)
        .onConflictDoUpdate({
          target: [
            attendanceSession.churchId,
            attendanceSession.serviceId,
            attendanceSession.date,
          ],
          set: values,
        })
        .returning({ id: attendanceSession.id });
    } else {
      // One-off event (no service): always insert a new row.
      [row] = await db
        .insert(attendanceSession)
        .values(values)
        .returning({ id: attendanceSession.id });
    }

    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("recordAttendance failed", e);
    return { ok: false, error: "Could not save attendance. Please try again." };
  }
}

export async function deleteAttendance(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Invalid id" };
  }
  const { church } = await requireChurch();
  if (!(await can("attendance.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  try {
    const [row] = await db
      .delete(attendanceSession)
      .where(
        and(
          eq(attendanceSession.id, id),
          eq(attendanceSession.churchId, church.id),
        ),
      )
      .returning({ id: attendanceSession.id });
    if (!row) return { ok: false, error: "Session not found." };

    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
    return { ok: true, id: row.id };
  } catch (e) {
    console.error("deleteAttendance failed", e);
    return { ok: false, error: "Could not delete. Please try again." };
  }
}
