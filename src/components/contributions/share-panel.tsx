"use client";

import { useState } from "react";
import { Copy, ExternalLink, Eye, EyeOff, Link2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import type { ContributionDetail } from "@/lib/contributions";
import {
  dueLabel,
  shareMessage,
  whatsappShareUrl,
} from "@/lib/contributions-shared";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";

/**
 * The share tab.
 *
 * WhatsApp is not an afterthought here, it is the distribution channel — this
 * whole feature reaches the forty people who need it as a message in a group
 * chat. So the message itself is treated as part of the product and shown before
 * it is sent, rather than left to whatever the OS share sheet composes. People
 * paste what they can see.
 *
 * The copy button only claims success once the clipboard write resolves. An
 * unconditional "Copied!" toast is a lie on any browser that refuses the
 * permission, and this is a link somebody is about to send to their department.
 */
export function SharePanel({
  pot,
  currency,
  today,
  url,
  canManage,
  onPublish,
}: {
  pot: ContributionDetail;
  currency: string;
  today: string;
  url: string;
  canManage: boolean;
  onPublish: () => void;
}) {
  const t = useT();
  const [showPreview, setShowPreview] = useState(true);

  const message = shareMessage({
    title: pot.title,
    raised: formatMoney(pot.raised, currency),
    target: pot.target ? formatMoney(pot.target, currency) : null,
    contributors: pot.contributors.filter((c) => c.paid > 0).length,
    url,
    dueLabel: dueLabel(pot.dueDate, today),
  });

  function copy(text: string, success: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(success))
      .catch(() => toast.error(t("contributions.couldntCopy")));
  }

  if (pot.visibility === "private") {
    return (
      <div className="bg-card rounded-2xl border p-6">
        <span className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-xl">
          <EyeOff className="size-5" aria-hidden />
        </span>
        <p className="mt-3 font-semibold">{t("contributions.linkTurnedOff")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("contributions.linkOffHint")}
        </p>
      </div>
    );
  }

  if (pot.status === "draft") {
    return (
      <div className="bg-card rounded-2xl border p-6">
        <span className="bg-warning/15 text-warning grid size-10 place-items-center rounded-xl">
          <Link2 className="size-5" aria-hidden />
        </span>
        <p className="mt-3 font-semibold">{t("contributions.draftNotLive")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("contributions.draftNotLiveHint")}
        </p>
        {canManage && (
          <Button className="mt-4" onClick={onPublish}>
            {t("contributions.startCollecting")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <h2 className="font-bold">{t("contributions.shareTitle")}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("contributions.shareBlurb")}
        </p>

        <div className="bg-muted/50 mt-4 flex items-center gap-2 rounded-xl border p-2.5">
          <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-xs sm:text-sm">
            {url}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => copy(url, t("contributions.linkCopied"))}
            aria-label={t("contributions.copyLink")}
          >
            <Copy className="size-4" />
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild>
            <a
              href={whatsappShareUrl(message)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="size-4" aria-hidden />{" "}
              {t("contributions.shareOnWhatsApp")}
            </a>
          </Button>
          <Button
            variant="outline"
            onClick={() => copy(message, t("contributions.messageCopied"))}
          >
            <Copy className="size-4" aria-hidden /> {t("contributions.copyMessage")}
          </Button>
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" aria-hidden />{" "}
              {t("contributions.openPublicPage")}
            </a>
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setShowPreview((s) => !s)}
          aria-expanded={showPreview}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
        >
          <span className="font-bold">{t("contributions.previewMessage")}</span>
          {showPreview ? (
            <EyeOff className="text-muted-foreground size-4" aria-hidden />
          ) : (
            <Eye className="text-muted-foreground size-4" aria-hidden />
          )}
        </button>
        {showPreview && (
          <pre className="bg-muted/50 mt-3 overflow-x-auto rounded-xl border p-3 text-sm whitespace-pre-wrap">
            {message}
          </pre>
        )}
      </div>

      {/*
        What the link gives away, in plain words. Somebody about to paste this
        into a group chat of forty people should not have to open the settings
        dialog to find out whether it names who has not paid.
      */}
      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        <h3 className="font-bold">{t("contributions.whatPeopleWillSee")}</h3>
        <ul className="text-muted-foreground mt-2 space-y-1.5 text-sm">
          <li>• {t("contributions.seeTotals")}</li>
          <li>
            •{" "}
            {pot.visibility === "detailed"
              ? t("contributions.seeEveryone")
              : t("contributions.seeNoNames")}
          </li>
          {pot.showPayouts && <li>• {t("contributions.seePayouts")}</li>}
          {pot.showOutstanding && (
            <li className="text-warning">• {t("contributions.seeOutstanding")}</li>
          )}
          {pot.allowSelfReport && <li>• {t("contributions.seeSelfReport")}</li>}
          {pot.payInstructions && <li>• {t("contributions.seeHowToPay")}</li>}
        </ul>
      </div>
    </div>
  );
}
