import { and, eq, max } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceSession,
  church,
  giving,
  member,
  session,
  staff,
  user,
} from "@/db/schema";
import { sendEmail } from "@/lib/mailer";
import {
  inactiveWeekEmail,
  reLoginEmail,
  weekendRecordEmail,
} from "@/lib/reminder-emails";
import { runFirstTimers } from "@/lib/first-timers";

export const dynamic = "force-dynamic";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysSince(ms: number) {
  return (Date.now() - ms) / 86_400_000;
}

/**
 * GET /api/cron/reminders  — run daily. Sends at most one reminder email per
 * church based on inactivity. Auth via ?key=CRON_SECRET or Bearer header.
 * Windowed conditions (e.g. 3–4 days) mean each reminder fires once.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("key");
  if (!secret || key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Owners of active churches.
  const owners = await db
    .select({
      churchId: church.id,
      churchName: church.name,
      ownerId: user.id,
      ownerEmail: user.email,
      ownerName: user.name,
    })
    .from(church)
    .innerJoin(
      staff,
      and(eq(staff.organizationId, church.id), eq(staff.role, "owner")),
    )
    .innerJoin(user, eq(user.id, staff.userId))
    .where(eq(church.status, "active"));

  const [attMax, givMax, memMax, sessMax] = await Promise.all([
    db
      .select({ churchId: attendanceSession.churchId, last: max(attendanceSession.date) })
      .from(attendanceSession)
      .groupBy(attendanceSession.churchId),
    db
      .select({ churchId: giving.churchId, last: max(giving.date) })
      .from(giving)
      .groupBy(giving.churchId),
    db
      .select({ churchId: member.churchId, last: max(member.createdAt) })
      .from(member)
      .groupBy(member.churchId),
    db
      .select({ userId: session.userId, last: max(session.updatedAt) })
      .from(session)
      .groupBy(session.userId),
  ]);

  const attBy = new Map(attMax.map((r) => [r.churchId, r.last]));
  const givBy = new Map(givMax.map((r) => [r.churchId, r.last]));
  const memBy = new Map(memMax.map((r) => [r.churchId, r.last]));
  const loginBy = new Map(sessMax.map((r) => [r.userId, r.last]));

  const now = new Date();
  const isMonday = now.getDay() === 1;
  let lastSat = "";
  if (isMonday) {
    const sat = new Date(now);
    sat.setDate(now.getDate() - 2);
    lastSat = iso(sat);
  }

  let sent = 0;
  const byKind: Record<string, number> = { login: 0, weekend: 0, inactive: 0 };

  for (const o of owners) {
    if (!o.ownerEmail) continue;
    const lastAtt = attBy.get(o.churchId) ?? null; // "YYYY-MM-DD"
    const lastGiv = givBy.get(o.churchId) ?? null;
    const lastMem = memBy.get(o.churchId) ?? null; // Date
    const lastLogin = loginBy.get(o.ownerId) ?? null; // Date

    const activityMs = Math.max(
      lastAtt ? Date.parse(lastAtt) : 0,
      lastGiv ? Date.parse(lastGiv) : 0,
      lastMem ? new Date(lastMem).getTime() : 0,
    );

    let email: { subject: string; html: string; text: string } | null = null;
    let kind = "";

    // Priority: inactive week > weekend miss (Mon) > no login.
    if (activityMs > 0 && daysSince(activityMs) >= 7 && daysSince(activityMs) < 8) {
      email = inactiveWeekEmail(o.ownerName, o.churchName);
      kind = "inactive";
    } else if (isMonday && (!lastAtt || lastAtt < lastSat)) {
      email = weekendRecordEmail(o.ownerName, o.churchName);
      kind = "weekend";
    } else if (
      lastLogin &&
      daysSince(new Date(lastLogin).getTime()) >= 3 &&
      daysSince(new Date(lastLogin).getTime()) < 4
    ) {
      email = reLoginEmail(o.ownerName, o.churchName);
      kind = "login";
    }

    if (email) {
      try {
        const ok = await sendEmail({
          to: o.ownerEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
        if (ok) {
          sent++;
          byKind[kind] = (byKind[kind] ?? 0) + 1;
        }
      } catch {
        /* keep going */
      }
    }
  }

  // Piggyback the daily first-timer nurture sequence so it runs without needing
  // a separate crontab entry. Idempotent — safe if the dedicated cron also runs.
  let firstTimers: Awaited<ReturnType<typeof runFirstTimers>> | null = null;
  try {
    firstTimers = await runFirstTimers();
  } catch (e) {
    console.error("[cron/reminders] first-timers failed", e);
  }

  // Housekeeping: clear out expired one-time codes.
  try {
    const { purgeExpiredOtps } = await import("@/lib/otp");
    await purgeExpiredOtps();
  } catch (e) {
    console.error("[cron/reminders] otp purge failed", e);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: owners.length, sent, byKind, firstTimers }),
    { headers: { "Content-Type": "application/json" } },
  );
}
