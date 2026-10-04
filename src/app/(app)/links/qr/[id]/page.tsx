import { notFound, redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { hasFeatures } from "@/lib/entitlements-server";
import { siteUrl } from "@/lib/site";
import { listLinks } from "@/lib/links";
import { getQrCode } from "@/lib/qr-codes";
import { getTheme } from "@/lib/church-themes";
import { PageContainer } from "@/components/app/page-header";
import { QrDesigner } from "@/components/links/qr-designer";

export const metadata = { title: "QR code" };

export default async function EditQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { church } = await requireChurch();
  await requireCan("links.view");
  const { id } = await params;

  const features = await hasFeatures("qrCodes", "shortLinks");
  if (!features.qrCodes) redirect("/links");

  const [code, canManage] = await Promise.all([
    getQrCode(church.id, id),
    can("links.manage"),
  ]);
  if (!code) notFound();

  /*
   * Every active link, plus the one this code points at even if it is paused
   * or retired. Otherwise opening an old code whose link has since been paused
   * would show "Choose a link…" and silently drop the connection on the next
   * save — losing the one thing a dynamic code is for.
   */
  const links = features.shortLinks ? await listLinks(church.id) : [];
  const choices = links.filter(
    (l) => l.status === "active" || l.id === code.shortLinkId,
  );

  const brand = getTheme(church.theme).primary;

  return (
    <PageContainer className="max-w-7xl">
      <QrDesigner
        codeId={code.id}
        initialTitle={code.title}
        initialPayload={code.payload}
        initialDesign={code.design}
        initialLinkId={code.shortLinkId}
        links={choices.map((l) => ({
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
