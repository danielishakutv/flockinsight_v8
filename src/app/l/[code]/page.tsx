import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { ArrowRight, Link2Off } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import { dayKeyIn, recordClick, resolveCode } from "@/lib/links";
import {
  QR_PARAM,
  QR_PARAM_VALUE,
  REFUSAL_BODY,
  REFUSAL_HEADING,
  deviceOf,
  refusalFor,
  sourceOf,
} from "@/lib/links-shared";

/**
 * A short link, followed.
 *
 * WHY THIS IS A PAGE AND NOT A ROUTE HANDLER. The happy path never renders:
 * `redirect()` sends the visitor on before any markup exists. The unhappy path
 * is the whole reason for the file. A route handler can only answer with a
 * status and a body, so a paused link would be a bare 404 — and a 404 from a
 * poster outside a church tells the person holding the phone that they mistyped
 * it, which is usually wrong and always unhelpful. Four different situations
 * get four different sentences here, and each one says whether trying again
 * later is worth it.
 *
 * A 307, NOT A 301. A permanent redirect is cached by the browser, by every
 * proxy in between, and in practice for ever — so a church that changed where
 * a printed poster points would find that the people who had already scanned
 * it kept going to the old place, with nothing to clear and nothing to blame.
 * The editable destination is the entire feature; it cannot be cached away.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Never indexed. These are redirects, and the refusal pages are errors.
  robots: { index: false, follow: false },
  title: "Link",
};

export default async function ShortLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);

  /*
   * Read outside any try/catch, and before anything that might throw.
   * `headers()` makes this render dynamic by bailing out of the static pass,
   * and a try/catch around it swallows that bail-out — which freezes the page
   * at build time. See lib/i18n notes on the same trap.
   */
  const head = await headers();
  const referrer = head.get("referer");
  const userAgent = head.get("user-agent");

  const link = await resolveCode(code);
  if (!link) return <Refusal reason="missing" code={code} />;

  const refusal = refusalFor(link);
  if (refusal) return <Refusal reason={refusal} code={code} />;

  /*
   * The scan marker. A QR code's target carries `?s=qr`, because a camera
   * sends no referrer and neither does a typed address — without the marker
   * the one number a church most wants ("did anybody scan the poster?") is
   * indistinguishable from people typing the link in.
   */
  const isQr =
    (Array.isArray(query[QR_PARAM]) ? query[QR_PARAM][0] : query[QR_PARAM]) ===
    QR_PARAM_VALUE;

  after(async () => {
    /*
     * Counted after the response, so a visitor on a slow connection outside a
     * church is already on their way before any of this runs. `recordClick`
     * never throws; the timezone read is the only thing here that touches
     * another table, and it decides which DAY a Sunday-evening scan belongs
     * to — in the church's own timezone, not the server's.
     */
    const [c] = await db
      .select({ timezone: church.timezone })
      .from(church)
      .where(eq(church.id, link.churchId))
      .limit(1);

    await recordClick({
      linkId: link.id,
      churchId: link.churchId,
      day: dayKeyIn(c?.timezone),
      source: sourceOf(referrer, isQr),
      device: deviceOf(userAgent),
    });
  });

  redirect(link.destination);
}

/* ============================================================
 * When it does not go anywhere
 * ========================================================== */

function Refusal({
  reason,
  code,
}: {
  reason: "missing" | "paused" | "archived" | "expired";
  code: string;
}) {
  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="bg-card w-full max-w-md rounded-2xl border p-6 text-center shadow-sm sm:p-8">
        <div className="bg-muted mx-auto mb-5 flex size-12 items-center justify-center rounded-full">
          <Link2Off className="text-muted-foreground size-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          {REFUSAL_HEADING[reason]}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {REFUSAL_BODY[reason]}
        </p>
        <p className="text-muted-foreground/80 mt-4 font-mono text-xs break-all">
          /l/{code}
        </p>
        <Link
          href="/"
          className="text-primary mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
        >
          Go to FlockInsight
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
