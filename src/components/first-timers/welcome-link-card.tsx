"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  regenerateWelcomeLink,
  setWelcomeLinkEnabled,
} from "@/app/(app)/first-timers/actions";
import { renderSvg } from "@/lib/qr/render";
import { buildSimple, DEFAULT_CHOICE } from "@/lib/qr/simple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The welcome-desk card: a public link, a QR code, and an off switch.
 *
 * Off by default. This link lets anybody who has it put a row into the
 * church's register, which is a reasonable thing to want on a welcome card and
 * an unreasonable thing to switch on for every church without asking.
 */
export function WelcomeLinkCard({
  url,
  enabled,
  churchName,
}: {
  url: string;
  enabled: boolean;
  churchName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  /*
   * `buildSimple` rather than encode-then-render by hand: it is the call that
   * also runs the auto-fix, so the code it returns is one that actually
   * scans — the correction level and grid size are worked out from what is in
   * it rather than hoped for.
   */
  const svg = useMemo(() => {
    const built = buildSimple(url, DEFAULT_CHOICE);
    if (!built.ok) return null;
    return renderSvg(built.symbol, built.design, {
      title: `${churchName} — welcome`,
    });
  }, [url, churchName]);

  function copy() {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      /*
       * Not an empty catch. Clipboard access is refused outright in some
       * browsers and over plain http, and a Copy button that does nothing and
       * says nothing is the exact shape of bug this codebase has a rule about.
       */
      () => toast.error("Your browser would not let us copy. Select the link and copy it by hand."),
    );
  }

  function toggle(next: boolean) {
    startTransition(async () => {
      const res = await setWelcomeLinkEnabled(next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        next
          ? "The link is live. Anyone with it can register themselves."
          : "The link is off. It now leads nowhere.",
      );
      router.refresh();
    });
  }

  function regenerate() {
    startTransition(async () => {
      const res = await regenerateWelcomeLink();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("New link issued. Reprint any QR codes.");
      setConfirmNew(false);
      router.refresh();
    });
  }

  function downloadSvg() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "welcome-qr.svg";
    a.click();
    URL.revokeObjectURL(href);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="size-4" />
          Let people register themselves
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {enabled ? "The link is live" : "The link is off"}
            </p>
            <p className="text-muted-foreground text-xs">
              Put the code on a welcome card and a first-timer fills in their
              own details. They arrive as a visitor, in follow-up, exactly as if
              your team had written them down.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={toggle}
            disabled={pending}
            aria-label="Public first-timer link"
          />
        </div>

        {enabled && (
          <>
            <div className="flex gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>

            {svg && (
            <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
              {/*
                `dangerouslySetInnerHTML` on markup we generated ourselves, one
                line above, and nothing else can reach it:
                  - the SVG comes from `renderSvg`, our own encoder, never from
                    anything a user supplied as markup;
                  - the only user-controlled value in it is the church's name,
                    which `renderSvg` puts through `esc()` (render.ts:651) and
                    which `qr/design.test.ts` has a test for by name;
                  - the payload is a server-built URL from a slugified value.
                Same pattern as qr-controls, qr-list and qr-preview. React
                offers no way to mount an SVG string without this.
              */}
              <div
                className="w-40 max-w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <Button variant="outline" size="sm" onClick={downloadSvg}>
                <Download className="size-3.5" /> Download the code
              </Button>
            </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setConfirmNew(true)}
              disabled={pending}
            >
              <RefreshCw className="size-3.5" /> Issue a new link
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={confirmNew} onOpenChange={setConfirmNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue a new link?</DialogTitle>
            <DialogDescription>
              The current link stops working immediately. Every QR code you have
              already printed or shared will lead nowhere, so only do this if
              the old one has got somewhere it should not have.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNew(false)}>
              Keep the current link
            </Button>
            <Button variant="destructive" onClick={regenerate} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Issue a new link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
