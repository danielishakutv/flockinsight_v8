"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialsOf, type QrDesign } from "@/lib/qr/design";
import { payloadText, type QrPayload } from "@/lib/qr/payload";
import { qrTargetUrl } from "@/lib/links-shared";
import {
  DEFAULT_CHOICE,
  choiceFromDesign,
  type SimpleChoice,
} from "@/lib/qr/simple";
import { QrControls } from "@/components/links/qr-controls";
import { QrPayloadForm, type LinkChoice } from "@/components/links/qr-payload-form";
import { QrPreview, useQrState } from "@/components/links/qr-preview";
import { deleteCode, noteCodeDownload, saveCode } from "@/app/(app)/links/actions";
import { useT } from "@/components/i18n-provider";

/**
 * Make a QR code: where it goes, what it looks like, done.
 *
 * NO TABS AND NO CHECKS TAB. The previous version had three tabs, a twelve-up
 * preset gallery, thirty controls and a panel of scannability findings — and
 * the findings were the problem rather than the cure, because they described a
 * fault and asked the church to repair it. `autoFix` repairs it, so the whole
 * apparatus for reporting faults came out and what is left is one column of
 * four questions beside a preview.
 *
 * The state is still just the payload, the choice and the title; everything
 * else is derived on every change. Which is what keeps every control two-way:
 * there is no rendered result to fall out of step with the settings, because
 * the result is not stored anywhere.
 */

export type DesignerProps = {
  codeId: string | null;
  initialTitle: string;
  initialPayload: QrPayload;
  /** The stored design. The four choices are read back out of it. */
  initialDesign: QrDesign;
  initialLinkId: string | null;
  links: LinkChoice[];
  baseUrl: string;
  churchName: string;
  churchLogo: string | null;
  brandColor: string | null;
  canUseShortLinks: boolean;
  canManage: boolean;
};

export function QrDesigner(props: DesignerProps) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [payload, setPayload] = useState<QrPayload>(props.initialPayload);
  const [linkId, setLinkId] = useState<string | null>(props.initialLinkId);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const initials = useMemo(() => initialsOf(props.churchName), [props.churchName]);

  /*
   * The four choices, recovered from the stored design on a code that already
   * exists, and seeded from the church's own colour on a new one.
   */
  const [choice, setChoice] = useState<SimpleChoice>(() =>
    props.codeId
      ? choiceFromDesign(props.initialDesign)
      : {
          ...DEFAULT_CHOICE,
          colour: props.brandColor ?? DEFAULT_CHOICE.colour,
        },
  );

  /*
   * What the code encodes. For a dynamic code this is DERIVED from the chosen
   * short link rather than typed, so a code cannot be saved as dynamic while
   * pointing somewhere edited by hand, and the `?s=qr` marker that separates a
   * scan from a click is never left off.
   */
  const destination = useMemo(() => {
    if (payload.kind === "link") {
      const link = props.links.find((l) => l.id === linkId);
      return link ? qrTargetUrl(props.baseUrl, link.code) : "";
    }
    const text = payloadText(payload);
    return text.ok ? text.text : "";
  }, [payload, linkId, props.links, props.baseUrl]);

  const state = useQrState(destination, choice, title);

  function save() {
    if (!title.trim()) {
      toast.error(t("links.giveTheCodeAName"));
      return;
    }
    if (!state.ok) {
      toast.error(state.error);
      return;
    }
    startSave(async () => {
      const res = await saveCode({
        id: props.codeId,
        title: title.trim(),
        payload,
        // The design the auto-fix produced, not the one asked for: this is the
        // picture that has to render identically next year.
        design: state.design,
        shortLinkId: payload.kind === "link" ? linkId : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("links.saved"));
      if (!props.codeId && res.id) router.replace(`/links/qr/${res.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!props.codeId) return;
    if (
      !confirm(
        `Delete "${title}"? Any printed copies keep working — this only removes the design.`,
      )
    ) {
      return;
    }
    startDelete(async () => {
      const res = await deleteCode(props.codeId!);
      if (res.ok) {
        toast.success(t("links.deleted"));
        router.push("/links");
      } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link href="/links">
            <ArrowLeft className="size-4" />
            Links &amp; QR codes
          </Link>
        </Button>
        {props.canManage && (
          <div className="flex items-center gap-2">
            {props.codeId && (
              <Button
                onClick={remove}
                variant="outline"
                disabled={deleting}
                className="min-h-11"
              >
                {deleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            )}
            <Button onClick={save} disabled={saving} className="min-h-11">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {props.codeId ? "Save" : "Save this code"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="qr-title" className="text-xs font-medium">
          What to call it
        </Label>
        <Input
          id="qr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder={t("links.carolServiceRegistration")}
          className="min-h-11 text-base font-semibold"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <QrPayloadForm
            payload={payload}
            onChange={setPayload}
            links={props.links}
            baseUrl={props.baseUrl}
            canUseShortLinks={props.canUseShortLinks}
            selectedLinkId={linkId}
            onSelectLink={setLinkId}
          />
          <QrControls
            choice={choice}
            onChange={setChoice}
            churchLogo={props.churchLogo}
            churchInitials={initials}
          />
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <QrPreview
            state={state}
            title={title || "QR code"}
            destination={destination}
            onDownloaded={() => {
              if (props.codeId) void noteCodeDownload(props.codeId);
            }}
          />
        </div>
      </div>
    </div>
  );
}
