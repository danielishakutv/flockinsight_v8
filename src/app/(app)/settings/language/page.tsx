import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getLocalePreference, getT } from "@/lib/i18n/server";
import { isLocale, type LocaleCode } from "@/lib/i18n/locales";
import { LanguagePicker } from "@/components/settings/language-picker";

export const metadata = { title: "Language · Settings" };
export const dynamic = "force-dynamic";

export default async function LanguageSettingsPage() {
  const { church: c, user: me } = await requireChurch();
  const t = await getT();
  const canManageChurch = await can("settings.manage");

  /*
   * What the picker shows as selected for this person.
   *
   * Read from the account rather than from the resolved locale: somebody on
   * "follow my device" who happens to be on a French browser is resolving to
   * French, but their CHOICE is "follow my device", and the picker has to say
   * so or pressing it again would look like it did nothing.
   */
  const mine = await getLocalePreference();

  const [orgRow] = await db
    .select({ defaultLocale: church.defaultLocale })
    .from(church)
    .where(eq(church.id, c.id))
    .limit(1);
  const churchDefault: LocaleCode | "auto" =
    orgRow?.defaultLocale && isLocale(orgRow.defaultLocale)
      ? orgRow.defaultLocale
      : "auto";

  // Only read to confirm the row exists before the picker offers to write it.
  await db.select({ id: user.id }).from(user).where(eq(user.id, me.id)).limit(1);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">{t("settings.languageTitle")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.languageSubtitle")}
        </p>
      </div>

      <LanguagePicker
        mine={mine}
        churchDefault={churchDefault}
        canManageChurch={canManageChurch}
        churchName={c.name}
      />
    </div>
  );
}
