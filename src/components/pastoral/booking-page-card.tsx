"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renderSvg } from "@/lib/qr/render";
import { buildSimple, DEFAULT_CHOICE } from "@/lib/qr/simple";
import { regenerateBookingSlug, saveBookingPage } from "@/app/(app)/appointments/actions";
import type { PageItem } from "@/components/pastoral/appointments-browser";

/**
 * The public booking page's settings [manage]: on or off, who may use it,
 * the link and its QR code, the words on it, and which messages go out.
 *
 * Off by default, like the welcome link. Texts are off by default too: every
 * one is charged to the wallet, and on a public page the number was typed by
 * a stranger.
 */
export function BookingPageCard({ page, secretMissing }: { page: PageItem; secretMissing: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    enabled: page.enabled,
    visibility: page.visibility,
    title: page.title,
    intro: page.intro,
    emailBooker: page.emailBooker,
    smsBooker: page.smsBooker,
    notifyPastorByEmail: page.notifyPastorByEmail,
    reminderLeadHours: String(Math.round(page.reminderLeadMinutes / 60)),
    changeCutoffHours: String(page.changeCutoffHours),
    maxUpcomingPerContact: String(page.maxUpcomingPerContact),
  });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // buildSimple also runs the auto-fix, so the code it returns actually scans.
  const svg = useMemo(() => {
    const built = buildSimple(page.url, DEFAULT_CHOICE);
    if (!built.ok) return null;
    return renderSvg(built.symbol, built.design, { title: page.title });
  }, [page.url, page.title]);

  function copy() {
    navigator.clipboard.writeText(page.url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      // Clipboard access is refused in some browsers; say so rather than nothing.
      () => toast.error(t("pastoral.page.copyFailed")),
    );
  }

  function downloadSvg() {
    if (!svg) return;
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = "booking-qr.svg";
    a.click();
    // Revoked a moment later, or Safari and Firefox save nothing.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveBookingPage({
          enabled: form.enabled,
          visibility: form.visibility,
          title: form.title,
          intro: form.intro,
          emailBooker: form.emailBooker,
          smsBooker: form.smsBooker,
          notifyPastorByEmail: form.notifyPastorByEmail,
          reminderLeadMinutes: Math.round(Number(form.reminderLeadHours) * 60),
          changeCutoffHours: Number(form.changeCutoffHours),
          maxUpcomingPerContact: Number(form.maxUpcomingPerContact),
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast.success(t("pastoral.done.saved"));
        router.refresh();
      } catch (e) {
        console.error("[booking-page] could not save", e);
        setError(t("pastoral.errors.network"));
      }
    });
  }

  function regenerate() {
    startTransition(async () => {
      try {
        const res = await regenerateBookingSlug();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(t("pastoral.done.newLink"));
        setConfirmNew(false);
        router.refresh();
      } catch (e) {
        console.error("[booking-page] could not issue a new link", e);
        toast.error(t("pastoral.errors.network"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="size-4" /> {t("pastoral.page.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{form.enabled ? t("pastoral.page.live") : t("pastoral.page.off")}</p>
            <p className="text-muted-foreground text-xs">
              {form.enabled ? t("pastoral.page.liveHint") : t("pastoral.page.offHint")}
            </p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => set({ enabled: v })}
            aria-label={t("pastoral.page.title")}
          />
        </div>

        {page.enabled && (
          <>
            <div className="flex gap-2">
              <Input readOnly value={page.url} className="font-mono text-xs" aria-label={t("pastoral.page.title")} />
              <Button variant="outline" size="icon" className="size-11 shrink-0" onClick={copy} aria-label={t("common.copyLink")}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            {svg && (
              <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
                {/*
                  Markup from our own QR encoder, one line above; the only text
                  in it is the page title, which renderSvg escapes. The payload
                  is a server-built URL from a slugified value. Same pattern as
                  the welcome link card.
                */}
                <div className="w-40 max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
                <Button variant="outline" size="sm" className="min-h-11" onClick={downloadSvg}>
                  <Download className="size-3.5" /> {t("pastoral.page.downloadQr")}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="space-y-1.5">
          <Label>{t("pastoral.page.visibility")}</Label>
          <Select value={form.visibility} onValueChange={(v) => set({ visibility: v as "public" | "members" })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">{t("pastoral.page.visibilityPublic")}</SelectItem>
              <SelectItem value="members" disabled={secretMissing}>
                {t("pastoral.page.visibilityMembers")}
              </SelectItem>
            </SelectContent>
          </Select>
          {secretMissing && <p className="text-xs text-amber-700 dark:text-amber-300">{t("pastoral.page.secretMissing")}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bp-title">{t("pastoral.page.pageTitle")}</Label>
          <Input id="bp-title" value={form.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-intro">{t("pastoral.page.intro")}</Label>
          <Textarea id="bp-intro" value={form.intro} maxLength={1000} onChange={(e) => set({ intro: e.target.value })} />
        </div>

        {(
          [
            ["emailBooker", "pastoral.page.emailBooker"],
            ["smsBooker", "pastoral.page.smsBooker"],
            ["notifyPastorByEmail", "pastoral.page.notifyPastor"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{t(label)}</p>
              {k === "smsBooker" && <p className="text-muted-foreground text-xs">{t("pastoral.page.smsCost")}</p>}
            </div>
            <Switch checked={form[k]} onCheckedChange={(v) => set({ [k]: v })} aria-label={t(label)} />
          </div>
        ))}

        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["reminderLeadHours", "pastoral.page.reminderLead", 1, 72],
              ["changeCutoffHours", "pastoral.page.cutoff", 0, 168],
              ["maxUpcomingPerContact", "pastoral.page.maxUpcoming", 1, 10],
            ] as const
          ).map(([k, label, min, max]) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`bp-${k}`}>{t(label)}</Label>
              <Input
                id={`bp-${k}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={form[k]}
                onChange={(e) => set({ [k]: e.target.value })}
              />
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("common.saveChanges")}
          </Button>
          <Button variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => setConfirmNew(true)}>
            <RefreshCw className="size-3.5" /> {t("pastoral.page.regenerate")}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmNew} onOpenChange={setConfirmNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pastoral.page.regenerateConfirm")}</DialogTitle>
            <DialogDescription>{t("pastoral.page.regenerateWarn")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNew(false)}>
              {t("pastoral.page.keepLink")}
            </Button>
            <Button variant="destructive" onClick={regenerate} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("pastoral.page.regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
