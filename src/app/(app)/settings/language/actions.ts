"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { isLocale, LOCALE_COOKIE, localeInfo } from "@/lib/i18n/locales";
import { AUTO_LOCALE } from "@/lib/i18n/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** A year. Long enough that nobody re-picks their own language by accident. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Set the language for the person asking.
 *
 * Written to BOTH the cookie and the account, on purpose. The cookie is what
 * makes the very next request — including one served to a signed-out guest in a
 * meeting — come back in the right language with no database read. The account
 * row is what carries the choice to their next phone. Writing only one of the
 * two is how a setting appears to forget itself.
 */
export async function setMyLanguage(code: string): Promise<ActionResult> {
  const { user: me, church: c } = await requireChurch();

  const jar = await cookies();

  if (code === AUTO_LOCALE) {
    jar.set(LOCALE_COOKIE, AUTO_LOCALE, {
      maxAge: COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
    await db.update(user).set({ locale: null }).where(eq(user.id, me.id));

    await audit({
      churchId: c.id,
      action: "settings.language.update",
      summary: "Set their own language to follow their device",
      targetType: "user",
      targetId: me.id,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  }

  if (!isLocale(code)) return { ok: false, error: "We don't have that language." };

  jar.set(LOCALE_COOKIE, code, {
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  await db.update(user).set({ locale: code }).where(eq(user.id, me.id));

  await audit({
    churchId: c.id,
    action: "settings.language.update",
    summary: `Changed their own language to ${localeInfo(code).name}`,
    targetType: "user",
    targetId: me.id,
    meta: { locale: code },
  });

  /*
   * Every page in the app renders text, so every page is stale. `"layout"`
   * rather than a list of paths: naming them would mean remembering to add the
   * next one, and a page left out would keep serving the old language until
   * something else happened to invalidate it.
   */
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Set the church's default — what a team member sees before choosing, and what
 * somebody newly invited starts with. Never overrides anyone's own choice.
 */
export async function setChurchLanguage(code: string): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to change this." };

  const next = code === AUTO_LOCALE ? null : code;
  if (next !== null && !isLocale(next))
    return { ok: false, error: "We don't have that language." };

  await db
    .update(church)
    .set({ defaultLocale: next })
    .where(eq(church.id, c.id));

  await audit({
    churchId: c.id,
    action: "settings.language.update",
    summary: next
      ? `Set the church's default language to ${localeInfo(next).name}`
      : "Cleared the church's default language",
    targetType: "church",
    targetId: c.id,
    meta: { defaultLocale: next },
    severity: "notice",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The quick switcher in the app menu. Same as `setMyLanguage`, but it works for
 * anyone signed in — including a platform operator who has no church — so it
 * cannot require `requireChurch()`.
 */
export async function switchLanguage(code: string): Promise<ActionResult> {
  const jar = await cookies();

  if (code === AUTO_LOCALE) {
    jar.set(LOCALE_COOKIE, AUTO_LOCALE, {
      maxAge: COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
    revalidatePath("/", "layout");
    return { ok: true };
  }
  if (!isLocale(code)) return { ok: false, error: "We don't have that language." };

  jar.set(LOCALE_COOKIE, code, {
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });

  // Remember it on the account too, when there is one to remember it on.
  try {
    const { getSession } = await import("@/lib/session");
    const data = await getSession();
    if (data?.user) {
      await db.update(user).set({ locale: code }).where(eq(user.id, data.user.id));
    }
  } catch {
    /* a guest has nowhere to save it; the cookie is enough */
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
