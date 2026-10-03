"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, session as sessionTable, staff } from "@/db/schema";
import { getSession, requireUser } from "@/lib/session";
import { clearActAsCookie, readActAsCookie } from "@/lib/impersonation";
import { audit } from "@/lib/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Point this session at one of the churches this person belongs to.
 *
 * Three things make it safe to call from anywhere:
 *
 *  1. Membership is re-checked against the database every time. The id comes
 *     from a form, so it is a request, not a fact — and `temp: false` excludes
 *     the row a superadmin's impersonation leaves behind, which would otherwise
 *     turn every church they have ever visited into one of "theirs".
 *  2. Only THIS session moves. Updating every session of this user would
 *     silently switch the church on their other phone mid-sentence, which is
 *     the kind of thing that makes someone record attendance in the wrong
 *     church.
 *  3. Any "act as church" overlay is dropped. Choosing a church of your own
 *     while impersonating another is a contradiction, and leaving the cookie
 *     set would mean the chooser appeared to do nothing.
 */
export async function chooseChurch(churchId: string): Promise<ActionResult> {
  const data = await requireUser();
  const id = String(churchId || "");
  if (!id) return { ok: false, error: "Choose a church." };

  const [membership] = await db
    .select({ churchName: church.name, status: church.status })
    .from(staff)
    .innerJoin(church, eq(church.id, staff.organizationId))
    .where(
      and(
        eq(staff.userId, data.user.id),
        eq(staff.organizationId, id),
        eq(staff.temp, false),
      ),
    )
    .limit(1);
  if (!membership)
    return { ok: false, error: "You're not a member of that church." };

  await db
    .update(sessionTable)
    .set({ activeOrganizationId: id, updatedAt: new Date() })
    .where(eq(sessionTable.id, data.session.id));

  if (await readActAsCookie()) await clearActAsCookie();

  await audit({
    churchId: id,
    action: "auth.church.switch",
    summary: `Switched into ${membership.churchName}`,
    targetType: "church",
    targetId: id,
  });

  // Everything in the shell belongs to a church — the name, the nav, the plan,
  // every number on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Where this person should land right after signing in.
 *
 * Called by the login form instead of hardcoding /dashboard, because the right
 * answer depends on facts only the server holds: how many churches they are in,
 * whether they have one at all, and whether they are a platform operator. An
 * explicit `?redirect=` always wins over this — somebody following an invite
 * link is going where the link said.
 */
export async function landingPath(): Promise<string> {
  const data = await getSession();
  if (!data?.user) return "/login";

  const { getIsSuperAdmin, getMustChangePassword, getMyChurches } = await import(
    "@/lib/session"
  );

  // A forced password change comes before everything else; the app shell sends
  // them here anyway, and bouncing twice looks like a bug.
  if (await getMustChangePassword()) return "/set-password";

  const mine = await getMyChurches();
  // More than one, and nobody has chosen yet — so ask, rather than picking the
  // oldest membership and hoping it was the one they meant.
  if (mine.length > 1) return "/select-church";
  if (mine.length === 1) return "/dashboard";
  return (await getIsSuperAdmin()) ? "/superadmin" : "/onboarding";
}
