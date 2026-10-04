import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  History,
  Monitor,
  MousePointerClick,
  Plus,
  QrCode,
  ScanLine,
  Smartphone,
  Tablet,
} from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeature } from "@/lib/entitlements-server";
import { siteUrl } from "@/lib/site";
import { destinationHistory, getLink, linkStats } from "@/lib/links";
import { qrCodesForLink } from "@/lib/qr-codes";
import {
  DEVICE_LABEL,
  LINK_STATUS_LABEL,
  LINK_STATUS_TONE,
  prettyDestination,
  shortUrlForPrint,
} from "@/lib/links-shared";
import { PageContainer } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkFollows } from "@/components/charts/link-follows";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Short link" };

/**
 * One short link: who followed it, and everywhere it has pointed.
 *
 * The history is the part that earns its place. "Change where it goes" is the
 * feature, and a change with no record of what it used to be is a feature
 * nobody can trust — when a poster stops working, the question is always
 * "what did this used to do", and this is the only page that can answer it.
 */
export default async function LinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getT();
  const { church } = await requireChurch();
  await requireCan("links.view");
  const { id } = await params;

  const link = await getLink(church.id, id);
  if (!link) notFound();

  const [stats, history, codes, canManage, canUseShortLinks] = await Promise.all([
    linkStats(church.id, link.id, 30),
    destinationHistory(church.id, link.id),
    qrCodesForLink(church.id, link.id),
    can("links.manage"),
    hasFeature("shortLinks"),
  ]);

  const base = siteUrl();
  const scans = stats.sources.find((s) => s.key === "qr")?.clicks ?? 0;
  const typed = stats.sources.find((s) => s.key === "direct")?.clicks ?? 0;
  const referred = stats.sources.filter((s) => s.key !== "qr" && s.key !== "direct");

  return (
    <PageContainer className="max-w-5xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 min-h-11">
        <Link href="/links">
          <ArrowLeft className="size-4" />
          Links &amp; QR codes
        </Link>
      </Button>

      {/* ---------------------------------------------- the link itself */}
      <div className="bg-card rounded-2xl border p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">
                {link.title || `/l/${link.code}`}
              </h1>
              <Badge className={cn(LINK_STATUS_TONE[link.status])}>
                {LINK_STATUS_LABEL[link.status]}
              </Badge>
            </div>
            <p className="mt-1.5 font-mono text-sm font-semibold break-all">
              {shortUrlForPrint(base, link.code)}
            </p>
            <p className="text-muted-foreground mt-1 text-sm break-all">
              goes to{" "}
              <a
                href={link.destination}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {prettyDestination(link.destination, 80)}
              </a>
            </p>
            {link.note && (
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed italic">
                {link.note}
              </p>
            )}
          </div>

          {canManage && canUseShortLinks && (
            <Button asChild className="min-h-11">
              <Link href={`/links/qr/new?link=${link.id}&title=${encodeURIComponent(link.title ?? link.code)}`}>
                <Plus className="size-4" />
                Make a QR code for it
              </Link>
            </Button>
          )}
        </div>

        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Made {format(link.createdAt, "d MMMM yyyy")}
          {link.createdByName ? ` by ${link.createdByName}` : ""}
          {link.expiresAt
            ? ` · stops working ${format(link.expiresAt, "d MMMM yyyy")}`
            : ""}
          . Edit it from the list to change where it goes.
        </p>
      </div>

      {/* ---------------------------------------------- the figures */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Figure
          icon={<MousePointerClick className="size-4" />}
          value={stats.total.toLocaleString()}
          label={t("links.followsAllTime")}
        />
        <Figure
          icon={<ScanLine className="size-4" />}
          value={scans.toLocaleString()}
          label={t("links.scannedAQrCode")}
        />
        <Figure
          icon={<MousePointerClick className="size-4" />}
          value={typed.toLocaleString()}
          label={t("links.typedItOrTappedIt")}
        />
      </div>

      <div className="bg-card mt-5 rounded-2xl border p-4 sm:p-6">
        <h2 className="font-semibold">{t("links.theLast30Days")}</h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Every day is shown, including the empty ones — so a Sunday spike looks like a
          Sunday spike rather than a busy week.
        </p>
        <div className="mt-4">
          <LinkFollows
            data={stats.byDay.map((d) => ({
              label: format(new Date(`${d.day}T12:00:00Z`), "d MMM"),
              clicks: d.clicks,
            }))}
          />
        </div>
      </div>

      {/* ---------------------------------------------- where from, on what */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="bg-card rounded-2xl border p-4 sm:p-6">
          <h2 className="font-semibold">{t("links.whereTheyCameFrom")}</h2>
          {referred.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Nothing beyond scans and direct follows yet. A website or a social post
              that links here would appear by name; WhatsApp and most apps send no
              referrer at all, so those are counted as direct.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {referred.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{s.key}</span>
                  <span className="font-semibold tabular-nums">
                    {s.clicks.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card rounded-2xl border p-4 sm:p-6">
          <h2 className="font-semibold">{t("links.onWhat")}</h2>
          {stats.devices.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Nobody has followed it yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {stats.devices.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5">
                    {d.key === "phone" ? (
                      <Smartphone className="size-4" />
                    ) : d.key === "tablet" ? (
                      <Tablet className="size-4" />
                    ) : (
                      <Monitor className="size-4" />
                    )}
                    {DEVICE_LABEL[d.key] ?? d.key}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {d.clicks.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---------------------------------------------- the codes */}
      {codes.length > 0 && (
        <div className="bg-card mt-5 rounded-2xl border p-4 sm:p-6">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <QrCode className="size-4" />
            {codes.length} QR code{codes.length === 1 ? "" : "s"} point
            {codes.length === 1 ? "s" : ""} at this link
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            Which means it may be printed. Changing where the link goes updates every one
            of these at once; pausing it stops them all.
          </p>
          <ul className="mt-3 space-y-1.5">
            {codes.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/links/qr/${c.id}`}
                  className="hover:bg-muted flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-sm"
                >
                  <span className="truncate font-medium">{c.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {c.downloadCount > 0
                      ? `downloaded ${c.downloadCount}×`
                      : "not downloaded"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------------------------------------- the history */}
      <div className="bg-card mt-5 rounded-2xl border p-4 sm:p-6">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <History className="size-4" />
          Everywhere it has pointed
        </h2>
        <ol className="mt-3 space-y-3">
          {history.map((h, i) => (
            <li key={`${h.changedAt.toISOString()}-${i}`} className="flex gap-3">
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  i === 0 ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm break-all">
                  {prettyDestination(h.destination, 80)}
                  {i === 0 && (
                    <Badge variant="secondary" className="ml-2 align-middle text-xs">
                      now
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground text-xs">
                  {i === history.length - 1 ? "set when it was made" : "changed"}{" "}
                  {format(h.changedAt, "d MMM yyyy, HH:mm")}
                  {h.changedByName ? ` by ${h.changedByName}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </PageContainer>
  );
}

function Figure({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}
