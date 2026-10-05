"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  BarChart3,
  Copy,
  Link2,
  Loader2,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  LINK_STATUS_LABEL,
  LINK_STATUS_TONE,
  codeProblem,
  normaliseCode,
  prettyDestination,
  shortUrl,
  shortUrlForPrint,
  type LinkStatus,
} from "@/lib/links-shared";
import { saveLink, setStatus, suggestCode } from "@/app/(app)/links/actions";
import { useT } from "@/components/i18n-provider";

export type LinkListRow = {
  id: string;
  code: string;
  title: string | null;
  destination: string;
  status: LinkStatus;
  note: string | null;
  /** ISO, because a Date through a cache comes back as a string anyway. */
  expiresAt: string | null;
  clickCount: number;
  lastClickAt: string | null;
  createdAt: string;
  qrCount: number;
  /**
   * Whether the expiry has passed, decided on the SERVER.
   *
   * Not computed here from `Date.now()`. A render that reads the clock is not
   * idempotent — React may re-render at any moment and get a different answer,
   * and the lint rule that caught this exists because that produces a row that
   * silently changes what it says. The server already knows the time, and its
   * answer is the one the redirect itself will use.
   */
  expired: boolean;
};

/**
 * The short links a church has.
 *
 * `qrCount` is shown on every row and is the reason this list is not just a
 * table of links: a link with three QR codes pointing at it is printed
 * somewhere, and pausing it stops a poster working. The count is what turns
 * "retire this" from a tidy-up into a decision.
 */
export function LinksList({
  links,
  baseUrl,
  canManage,
  locked,
  lockedMessage,
}: {
  links: LinkListRow[];
  baseUrl: string;
  canManage: boolean;
  /** The plan does not include the shortener: reads work, writes do not. */
  locked: boolean;
  lockedMessage: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState<LinkListRow | "new" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            <Link2 className="size-4" />
            {t("links.shortLinks")}
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("links.oneShortAddressYouCan")}
          </p>
        </div>
        {canManage && !locked && (
          <Button onClick={() => setEditing("new")} className="min-h-11">
            <Plus className="size-4" />
            {t("links.newShortLink")}
          </Button>
        )}
      </div>

      {locked && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Lock className="size-4" />
            {t("links.shortLinksAreOnThe")}
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {lockedMessage}
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3 min-h-11">
            <Link href="/settings/billing">{t("links.seeThePlans")}</Link>
          </Button>
        </div>
      )}

      {links.length === 0 ? (
        <div className="text-muted-foreground rounded-2xl border border-dashed py-12 text-center">
          <Link2 className="mx-auto mb-3 size-7 opacity-60" />
          <p className="text-sm">{t("links.noShortLinksYet")}</p>
          {canManage && !locked && (
            <p className="mx-auto mt-1 max-w-sm px-6 text-xs leading-relaxed">
              {t("links.theFirstOneWorthMaking")}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              baseUrl={baseUrl}
              canManage={canManage && !locked}
              onEdit={() => setEditing(link)}
            />
          ))}
        </div>
      )}

      {editing && (
        <LinkDialog
          link={editing === "new" ? null : editing}
          baseUrl={baseUrl}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
 * One row
 * ========================================================== */

function LinkRow({
  link,
  baseUrl,
  canManage,
  onEdit,
}: {
  link: LinkListRow;
  baseUrl: string;
  canManage: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  function copy() {
    navigator.clipboard
      .writeText(shortUrl(baseUrl, link.code))
      .then(() => toast.success(t("links.copied")))
      .catch(() => toast.error(t("links.yourBrowserWouldNotLet")));
  }

  function toggle() {
    const next: LinkStatus = link.status === "active" ? "paused" : "active";
    if (
      next === "paused" &&
      link.qrCount > 0 &&
      !confirm(
        `${link.qrCount} QR code${link.qrCount === 1 ? "" : "s"} point${link.qrCount === 1 ? "s" : ""} at this link. Pausing it stops those scanning — including any already printed. Pause it?`,
      )
    ) {
      return;
    }
    start(async () => {
      const res = await setStatus(link.id, next);
      if (res.ok) {
        toast.success(next === "active" ? "Back on." : "Paused.");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="bg-card rounded-2xl border p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/links/${link.id}`}
              className="truncate font-semibold hover:underline"
            >
              {link.title || `/l/${link.code}`}
            </Link>
            <Badge className={cn(LINK_STATUS_TONE[link.status])}>
              {LINK_STATUS_LABEL[link.status]}
            </Badge>
            {link.expired && link.status === "active" && (
              <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">
                {t("links.expired")}
              </Badge>
            )}
            {link.qrCount > 0 && (
              <Badge variant="secondary" className="gap-1">
                <QrCode className="size-3" />
                {link.qrCount}
              </Badge>
            )}
          </div>

          <button
            type="button"
            onClick={copy}
            className="text-primary mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
          >
            <Copy className="size-3.5 shrink-0" />
            <span className="truncate">{shortUrlForPrint(baseUrl, link.code)}</span>
          </button>

          <p className="text-muted-foreground mt-0.5 text-xs break-all">
            goes to {prettyDestination(link.destination, 70)}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {link.clickCount.toLocaleString()} follow
            {link.clickCount === 1 ? "" : "s"}
            {link.lastClickAt
              ? ` · last ${format(new Date(link.lastClickAt), "d MMM")}`
              : " · none yet"}
            {link.expiresAt
              ? ` · ${link.expired ? "expired" : "expires"} ${format(new Date(link.expiresAt), "d MMM yyyy")}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={`/links/${link.id}`}>
              <BarChart3 className="size-4" />
              <span className="hidden sm:inline">{t("links.figures")}</span>
            </Link>
          </Button>
          {canManage && (
            <>
              <Button
                onClick={onEdit}
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`Edit ${link.title || link.code}`}
              >
                <Pencil className="size-4" />
              </Button>
              {link.status !== "archived" && (
                <Button
                  onClick={toggle}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  className="min-h-11"
                  aria-label={
                    link.status === "active"
                      ? `Pause ${link.code}`
                      : `Turn ${link.code} back on`
                  }
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : link.status === "active" ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Create / edit
 * ========================================================== */

function LinkDialog({
  link,
  baseUrl,
  onClose,
}: {
  link: LinkListRow | null;
  baseUrl: string;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState(link?.title ?? "");
  const [code, setCode] = useState(link?.code ?? "");
  const [destination, setDestination] = useState(link?.destination ?? "");
  const [note, setNote] = useState(link?.note ?? "");
  const [expiresOn, setExpiresOn] = useState(
    link?.expiresAt ? link.expiresAt.slice(0, 10) : "",
  );
  const [status, setStatusValue] = useState<LinkStatus>(link?.status ?? "active");
  const [saving, startSave] = useTransition();
  const [suggesting, startSuggest] = useTransition();

  const normalised = normaliseCode(code);
  const problem = normalised ? codeProblem(normalised) : null;

  function suggest() {
    startSuggest(async () => {
      const res = await suggestCode(title || destination);
      if (res) setCode(res.code);
      else toast.error(t("links.couldNotSuggestACode"));
    });
  }

  function submit() {
    startSave(async () => {
      const res = await saveLink({
        id: link?.id ?? null,
        code: normalised,
        destination,
        title,
        note,
        expiresOn,
        status,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(link ? "Saved." : "Link made.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{link ? "Edit this short link" : "New short link"}</DialogTitle>
          <DialogDescription>
            {link
              ? "Changing where it goes takes effect at once, everywhere it is printed."
              : "Pick something short and easy to read out. The address never changes; where it goes can."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="link-destination" className="text-xs font-medium">
              {t("links.whereShouldItGo")}
            </Label>
            <Input
              id="link-destination"
              type="url"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={t("links.graceChurchGive")}
              className="min-h-11"
            />
            <p className="text-muted-foreground text-xs">
              {t("links.youCanLeaveOffHttps")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="short-code" className="text-xs font-medium">
              {t("links.theShortAddress")}
            </Label>
            <div className="flex gap-2">
              <div className="border-input bg-background flex min-h-11 min-w-0 flex-1 items-center rounded-lg border pl-3">
                <span className="text-muted-foreground shrink-0 text-sm">
                  {shortUrlForPrint(baseUrl, "")}
                </span>
                <input
                  id="short-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("links.give")}
                  spellCheck={false}
                  autoCapitalize="none"
                  className="min-w-0 flex-1 bg-transparent px-0.5 py-2 text-sm font-semibold focus-visible:outline-none"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={suggest}
                disabled={suggesting}
                className="min-h-11 shrink-0"
              >
                {suggesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Suggest
              </Button>
            </div>
            {problem ? (
              <p className="text-xs leading-relaxed text-rose-600 dark:text-rose-400">
                {problem}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("links.aSuggestedCodeLeavesOut")}
              </p>
            )}
            {link && normalised !== link.code && (
              <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                Changing the address breaks every printed copy of the old one, and the
                old code becomes free for another church to take. Change where it{" "}
                <em>{t("links.goes")}</em> instead, unless nothing is printed yet.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="short-name" className="text-xs font-medium">
              {t("links.whatToCallIt")}
            </Label>
            <Input
              id="short-name"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 160))}
              placeholder={t("links.givingPage")}
              className="min-h-11"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="stop-on" className="text-xs font-medium">
                {t("links.stopWorkingOn")}
              </Label>
              <Input
                id="stop-on"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="min-h-11"
              />
              <p className="text-muted-foreground text-xs">
                {t("links.leaveEmptyForNever")}
              </p>
            </div>
            {link && (
              <div className="space-y-1.5">
                <Label htmlFor="short-status" className="text-xs font-medium">
                  {t("common.status")}
                </Label>
                <select
                  id="short-status"
                  value={status}
                  onChange={(e) => setStatusValue(e.target.value as LinkStatus)}
                  className="border-input bg-background focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="active">{t("links.liveRedirecting")}</option>
                  <option value="paused">{t("links.pausedShowsAMessage")}</option>
                  <option value="archived">{t("links.retiredKeepsTheCodeReserved")}</option>
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="short-note" className="text-xs font-medium">
              {t("links.aNoteForWhoeverFinds")}
            </Label>
            <Textarea
              id="short-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 600))}
              placeholder={t("links.onTheBackOfThe")}
              rows={2}
              maxLength={600}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="min-h-11">
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !!problem || !destination.trim()}
            className="min-h-11"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {link ? "Save" : "Make the link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
