import Link from "next/link";
import { BookOpen, MousePointerClick, QrCode, ScanLine } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeatures } from "@/lib/entitlements-server";
import { upgradeMessage } from "@/lib/entitlements";
import { siteUrl } from "@/lib/site";
import { churchLinkStats, listLinks } from "@/lib/links";
import { listQrCodes } from "@/lib/qr-codes";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { LinksList } from "@/components/links/links-list";
import { QrCodeList } from "@/components/links/qr-list";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Links & QR codes" };

/**
 * One page for both halves.
 *
 * They are separate features on separate plans and they are one screen,
 * because a church arrives here with one intention — "put this on a poster" —
 * and that needs a link and a code together. Splitting them into two pages
 * would make the useful thing (a printed code whose destination can change) a
 * journey across two menus, which is the kind of split only the billing model
 * would have asked for.
 */
export default async function LinksPage() {
  const t = await getT();
  const { church } = await requireChurch();
  await requireCan("links.view");

  const [canManage, features] = await Promise.all([
    can("links.manage"),
    hasFeatures("shortLinks", "qrCodes"),
  ]);

  const [links, codes, stats] = await Promise.all([
    listLinks(church.id),
    listQrCodes(church.id),
    churchLinkStats(church.id, 30),
  ]);

  const base = siteUrl();
  return (
    <PageContainer>
      <PageHeader
        title={t("links.linksQrCodes")}
        description={t("links.shortLinksYouCanRepoint")}
        action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/help/links-and-qr">
              <BookOpen className="size-4" />
              How to use it
            </Link>
          </Button>
        }
      />

      {/* ---------------------------------------------- the figures */}
      {links.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat
            icon={<MousePointerClick className="size-4" />}
            value={stats.total.toLocaleString()}
            label={t("links.followsAllTime")}
          />
          <Stat
            icon={<ScanLine className="size-4" />}
            value={stats.scans.toLocaleString()}
            label={t("links.ofThoseWereScansOf")}
            hint={
              stats.scans === 0 && stats.total > 0
                ? "A scan is counted when somebody uses a QR code made here. Codes made elsewhere look like typed links."
                : undefined
            }
          />
          <Stat
            icon={<QrCode className="size-4" />}
            value={String(codes.length)}
            label={codes.length === 1 ? "code saved" : "codes saved"}
          />
        </div>
      )}

      <div className="space-y-8">
        <QrCodeList
          codes={codes.map((c) => ({
            id: c.id,
            title: c.title,
            kind: c.kind,
            payload: c.payload,
            design: c.design,
            shortLinkCode: c.shortLinkCode,
            summary: c.summary,
            downloadCount: c.downloadCount,
            updatedAt: c.updatedAt.toISOString(),
          }))}
          canManage={canManage && features.qrCodes}
        />

        <LinksList
          links={links.map((l) => ({
            id: l.id,
            code: l.code,
            title: l.title,
            destination: l.destination,
            status: l.status,
            note: l.note,
            /*
             * Dates handed across as ISO strings, not Date objects. A Date that
             * goes through a cached render comes back as a string on a cache
             * hit, so a component that calls `.getTime()` on it works on the
             * first load and throws on the second. Sending strings makes the
             * two paths identical.
             */
            expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
            clickCount: l.clickCount,
            lastClickAt: l.lastClickAt ? l.lastClickAt.toISOString() : null,
            createdAt: l.createdAt.toISOString(),
            qrCount: l.qrCount,
            expired: l.expired,
          }))}
          baseUrl={base}
          canManage={canManage}
          locked={!features.shortLinks}
          lockedMessage={upgradeMessage("shortLinks")}
        />
      </div>
    </PageContainer>
  );
}

function Stat({
  icon,
  value,
  label,
  hint,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
      {hint && (
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
}
