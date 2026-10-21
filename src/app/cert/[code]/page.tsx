import type { Metadata } from "next";
import { AlertTriangle, BadgeCheck, SearchX } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/formatting";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normaliseCertCode, rankInfo, type CertRank } from "@/lib/certification-shared";
import { getCertificateByCode } from "@/lib/certification";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("course.verifyTitle"),
    // It names a person. It is for whoever holds the paper, not for search
    // results; robots.ts lists /cert/ as private too.
    robots: { index: false, follow: false },
  };
}

/**
 * The public check for a printed certificate. No sign-in, nothing to fill in,
 * nothing a stranger can set. It shows the holder's name, the rank and the
 * date, and never an email, a church, a score or an attempt.
 *
 * A malformed code and an unknown one render the same card, so the page does
 * not teach anybody the shape of a valid code by answering differently. With
 * 23^8 codes and 30 checks a minute per address, guessing one is not a plan.
 */
export default async function CertificateCheckPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const t = await getT();
  const { code: raw } = await params;

  const limit = rateLimit(`cert-verify:${await clientIp()}`, 30, 60_000);
  const code = limit.ok ? normaliseCertCode(raw) : null;
  const cert = code ? await getCertificateByCode(code) : null;
  const date = (d: Date) => formatDate(d, t.locale, "medium", "UTC");

  const requirement: Record<CertRank, string> = {
    professional: t("course.rankProfessionalNeeds"),
    master: t("course.rankMasterNeeds"),
    expert: t("course.rankExpertNeeds"),
  };

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-md px-4 py-10 lg:py-16">
        <p className="mb-6 text-center text-sm font-bold tracking-wide">FlockInsight</p>
        <h1 className="mb-4 text-center text-2xl font-extrabold tracking-tight">{t("course.verifyTitle")}</h1>

        {!limit.ok ? (
          <div role="alert" className="bg-card rounded-2xl border p-6 text-center text-sm">
            {t("course.verifyTooMany", { seconds: limit.retryAfterSec })}
          </div>
        ) : !cert ? (
          <div className="bg-card flex flex-col items-center gap-3 rounded-2xl border p-6 text-center">
            <SearchX className="text-muted-foreground size-8" />
            <p className="text-sm">{t("course.verifyNotFound")}</p>
          </div>
        ) : cert.revokedAt ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-center">
            <AlertTriangle className="size-8 text-amber-600 dark:text-amber-400" />
            <p className="text-lg font-bold">{cert.holderName}</p>
            <p className="text-sm">{rankInfo(cert.rank).label}</p>
            <p className="text-sm font-medium">{t("course.verifyWithdrawn", { date: date(cert.revokedAt) })}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
            <BadgeCheck className="size-9 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
              {t("course.verifyValid")}
            </p>
            <p className="mt-2 text-2xl font-extrabold break-words">{cert.holderName}</p>
            <p className="font-semibold">{rankInfo(cert.rank).label}</p>
            <p className="text-muted-foreground text-sm">{t("course.verifyIssued", { date: date(cert.issuedAt) })}</p>
            <p className="text-muted-foreground mt-2 text-xs">{requirement[cert.rank]}</p>
            <p className="text-muted-foreground font-mono text-xs">{code}</p>
          </div>
        )}
      </div>
    </div>
  );
}
