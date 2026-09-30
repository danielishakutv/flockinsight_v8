import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriber } from "@/db/schema";
import { verifyUnsubscribe, decodeUnsubEmail } from "@/lib/devotionals";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; e?: string; t?: string }>;
}) {
  const t = await getT();
  // `t` in the URL is the signature token; the translator owns the name now.
  const { c, e, t: token } = await searchParams;
  let ok = false;
  let email = "";

  if (c && e && token) {
    email = decodeUnsubEmail(e);
    if (email && verifyUnsubscribe(c, email, token)) {
      await db
        .update(subscriber)
        .set({ status: "unsubscribed" })
        .where(
          and(
            eq(subscriber.churchId, c),
            eq(subscriber.email, email.toLowerCase()),
          ),
        );
      ok = true;
    }
  }

  return (
    <div className="bg-muted/40 grid min-h-dvh place-items-center px-4">
      <div className="bg-card w-full max-w-md rounded-2xl border p-8 text-center">
        {ok ? (
          <>
            <h1 className="text-xl font-bold">{t("common.youAposVeBeenUnsubscribed")}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {email} will no longer receive these emails. You can resubscribe any
              time from the church&apos;s page.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t("common.linkExpiredOrInvalid")}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              We couldn&apos;t process this unsubscribe link. Please use the link
              from a recent email, or contact the church directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
