import { requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/formatting";
import { isCertRank, rankInfo } from "@/lib/certification-shared";
import { getCertificate } from "@/lib/certification";
import { renderCertificatePdf } from "@/lib/certificate-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /help/course/certificate/<rank> — the signed-in person's own certificate.
 *
 * requireUser, not requireChurch: the certificate belongs to the person, not
 * to whichever church they have open, so no church permission applies (and
 * route-permission-guard.test.ts, which is about church data, does not).
 * /help is in the proxy matcher, so a signed-out request goes to login.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ rank: string }> }) {
  const { user } = await requireUser();
  const t = await getT();
  const { rank } = await params;
  if (!isCertRank(rank)) return new Response(t("course.pdfNotEarned"), { status: 404 });

  // In memory is fine for a download: the cost it guards is rendering, not a secret.
  const limit = rateLimit(`cert-pdf:${user.id}`, 10, 60_000);
  if (!limit.ok) {
    return new Response(t("course.pdfTooMany", { seconds: limit.retryAfterSec }), {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  const cert = await getCertificate(user.id, rank);
  if (!cert) return new Response(t("course.pdfNotEarned"), { status: 404 });
  if (cert.revokedAt) {
    return new Response(t("course.pdfWithdrawn", { date: formatDate(cert.revokedAt, t.locale, "medium", "UTC") }), {
      status: 410,
    });
  }

  const pdf = await renderCertificatePdf({
    holderName: cert.holderName,
    rank: cert.rank,
    code: cert.code,
    issuedAt: cert.issuedAt,
    activeWeeksAtIssue: cert.activeWeeksAtIssue,
    modulesAtIssue: cert.modulesAtIssue,
  });

  const filename = `${rankInfo(cert.rank).label.replace(/\s+/g, "-")}-${cert.code}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
