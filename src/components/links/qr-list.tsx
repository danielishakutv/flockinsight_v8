"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download, Link2, Plus, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { encodeQr } from "@/lib/qr/encode";
import { normaliseDesign, structuralMinVersion, type QrDesign } from "@/lib/qr/design";
import { KIND_LABEL, payloadText, type QrPayload } from "@/lib/qr/payload";
import { renderSvg } from "@/lib/qr/render";
import { prettyDestination } from "@/lib/links-shared";
import { useT } from "@/components/i18n-provider";

export type QrListRow = {
  id: string;
  title: string;
  kind: QrPayload["kind"];
  payload: QrPayload;
  design: QrDesign;
  shortLinkCode: string | null;
  summary: string;
  downloadCount: number;
  updatedAt: string;
};

/**
 * The codes a church has saved, each drawn as itself.
 *
 * Drawn rather than stored. A thumbnail would be an image to upload, store
 * against the church's quota, invalidate whenever the design changed, and
 * serve on every visit — for a picture the browser can produce from a few
 * hundred bytes of JSON in under a millisecond. The list therefore cannot show
 * a stale thumbnail, because there is no thumbnail.
 */
export function QrCodeList({
  codes,
  canManage,
}: {
  codes: QrListRow[];
  canManage: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            <QrCode className="size-4" />
            QR codes
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Your logo, your colours, and a check that it will really scan.
          </p>
        </div>
        {canManage && (
          <Button asChild className="min-h-11">
            <Link href="/links/qr/new">
              <Plus className="size-4" />
              New QR code
            </Link>
          </Button>
        )}
      </div>

      {codes.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-12 text-center">
          <QrCode className="mx-auto mb-3 size-7 opacity-60" />
          <p className="text-sm">{t("links.noQrCodesYet")}</p>
          {canManage && (
            <p className="mx-auto mt-1 max-w-sm px-6 text-xs leading-relaxed">
              Try your WiFi first — a code taped by the welcome desk means nobody ever
              reads the password out again.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {codes.map((code) => (
            <QrCard key={code.id} code={code} />
          ))}
        </div>
      )}
    </div>
  );
}

function QrCard({ code }: { code: QrListRow }) {
  const svg = useMemo(() => {
    const design = normaliseDesign(code.design);
    const text = payloadText(code.payload);
    if (!text.ok) return null;
    const encoded = encodeQr(text.text, {
      ecLevel: design.ecLevel,
      minVersion: Math.max(design.minVersion, structuralMinVersion(design)),
    });
    if (!encoded.ok) return null;
    // The frame is dropped in the list: a caption bar makes every card a
    // different height, and the words are already in the title above it.
    return renderSvg(encoded.symbol, { ...design, frame: { ...design.frame, style: "none" } });
  }, [code.design, code.payload]);

  return (
    <Link
      href={`/links/qr/${code.id}`}
      className="bg-card hover:border-primary/50 flex gap-3 rounded-2xl border p-3 transition"
    >
      <div className="bg-muted size-20 shrink-0 overflow-hidden rounded-xl">
        {svg ? (
          <div
            className="[&>svg]:block [&>svg]:size-full"
            // Our own renderer; see the note in qr-preview.tsx.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="text-muted-foreground/50 flex size-full items-center justify-center">
            <QrCode className="size-7" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{code.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">
            {KIND_LABEL[code.kind]}
          </Badge>
          {code.shortLinkCode && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Link2 className="size-3" />
              /l/{code.shortLinkCode}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {prettyDestination(code.summary, 46)}
        </p>
        {code.downloadCount > 0 && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <Download className="size-3" />
            downloaded {code.downloadCount}{" "}
            {code.downloadCount === 1 ? "time" : "times"}
          </p>
        )}
      </div>
    </Link>
  );
}
