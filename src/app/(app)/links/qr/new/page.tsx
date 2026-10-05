import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeatures } from "@/lib/entitlements-server";
import { siteUrl } from "@/lib/site";
import { listLinks } from "@/lib/links";
import { checkDestination } from "@/lib/links-shared";
import { getTheme } from "@/lib/church-themes";
import { PageContainer } from "@/components/app/page-header";
import { QrDesigner } from "@/components/links/qr-designer";
import { DEFAULT_DESIGN } from "@/lib/qr/design";
import { blankPayload } from "@/lib/qr/payload";

export const metadata = { title: "New QR code" };

/**
 * A new code.
 *
 * Accepts `?url=` and `?title=`, which is what makes a QR code reachable from
 * anywhere else in the app without every one of those pages carrying a copy of
 * the designer. A form, a public page and a giving link all link here with
 * their own address filled in — see `components/links/qr-button.tsx`.
 *
 * The handed-in address is validated like any other destination, because a
 * query parameter is not a trusted input even when the link that set it was
 * ours: this page can be reached by typing a URL.
 *
 * The look opens in the church's own colour; everything that decides whether
 * the code scans is worked out by `autoFix`, so this page passes no design
 * settings at all.
 */
export default async function NewQrPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; title?: string; link?: string }>;
}) {
  const { church } = await requireChurch();
  await requireCan("links.view");
  const features = await hasFeatures("qrCodes", "shortLinks");

  /*
   * A church whose plan does not include the designer cannot open it at all —
   * unlike the pages that hold records, there is nothing here to go back and
   * read. Sending them to the module, where the upgrade notice is, is kinder
   * than an empty designer that refuses to save. (The designer is on Starter,
   * so in practice this is only reached by a church with no plan row at all.)
   */
  if (!features.qrCodes) redirect("/links");

  const canManage = await can("links.manage");
  const query = await searchParams;

  const links = features.shortLinks
    ? await listLinks(church.id, { status: "active" })
    : [];

  const handed =
    typeof query.url === "string" ? checkDestination(query.url) : { ok: false as const };

  const preselected =
    typeof query.link === "string" && links.some((l) => l.id === query.link)
      ? query.link
      : null;

  /*
   * STARTS ON A TYPED ADDRESS, and that is a bug fix rather than a preference.
   *
   * It used to open on "one of your short links" whenever the plan included
   * them, so a church that had not made a link yet landed on an empty picker
   * with no preview at all and nothing it could do. "Paste the address" is both
   * the common case and the one that always works, so it is the default; an
   * address handed in by another page, or a link preselected by the links
   * module, still wins over it.
   */
  const payload = preselected
    ? blankPayload("link")
    : handed.ok
      ? { kind: "url" as const, url: handed.url }
      : blankPayload("url");

  const brand = getTheme(church.theme).primary;

  return (
    <PageContainer className="max-w-7xl">
      <QrDesigner
        codeId={null}
        initialTitle={typeof query.title === "string" ? query.title.slice(0, 120) : ""}
        initialPayload={payload}
        initialDesign={DEFAULT_DESIGN}
        initialLinkId={preselected}
        links={links.map((l) => ({
          id: l.id,
          code: l.code,
          title: l.title,
          destination: l.destination,
          status: l.status,
        }))}
        baseUrl={siteUrl()}
        churchName={church.name}
        churchLogo={church.logo}
        brandColor={brand}
        canUseShortLinks={features.shortLinks}
        canManage={canManage}
      />
    </PageContainer>
  );
}
