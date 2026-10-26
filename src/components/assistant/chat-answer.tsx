"use client";

import Link from "next/link";
import {
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  FileDown,
  FileText,
  Info,
  Lock,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import type { ChatAnswer, ChatQuestion } from "@/lib/assistant/shared";
import { AssistantAnswer } from "@/components/assistant/assistant-answer";
import { sourceTitle, useChat } from "@/components/assistant/chat-context";
import { chatMarkdown, markdownFilename, pdfHref } from "@/components/assistant/chat-shared";
import { downloadPdf, downloadText } from "@/components/assistant/chat-download";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/*
 * Row actions grow to 44px on a phone and go back to the dense 36px from sm
 * up, where a mouse does not need the room.
 */
const ACTION = "h-11 min-w-11 sm:h-9 sm:min-w-0";

/** The question as it was sent and stored: placeholders and all, with how many details were removed. */
export function QuestionBubble({ question }: { question: Pick<ChatQuestion, "content" | "redactions"> }) {
  const { t } = useChat();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap">
        {question.content}
      </div>
      {question.redactions > 0 && (
        <p className="text-muted-foreground text-xs">
          {t("assistant.removedDetails", { count: question.redactions })}
        </p>
      )}
    </div>
  );
}

/**
 * One answer, with everything that can be done to it: copy, save, download
 * (this answer alone, as a PDF from the server or as Markdown made right
 * here) and "Did this help?".
 *
 * Only a real answer gets the actions. The fixed sentences shown when the
 * guides had nothing, the question was off-topic or the model failed are
 * ours, not the model's: there is nothing in them worth keeping, and the
 * server refuses to save them anyway.
 */
export function AnswerCard({
  answer,
  question,
  conversationId,
  conversationTitle,
  rated,
  onRate,
  onSave,
  saving,
}: {
  answer: ChatAnswer;
  /** The question it answered, for the downloads. */
  question: ChatQuestion | null;
  /** Null only while the conversation has no id yet, which never lasts past the first answer. */
  conversationId: string | null;
  conversationTitle: string;
  rated?: "thanks" | "sorry";
  onRate: (id: string, helpful: boolean) => void;
  onSave: (answer: ChatAnswer, saved: boolean) => void;
  saving: boolean;
}) {
  const { t, scope, links } = useChat();
  const answered = answer.kind === "answered";
  const saved = answer.savedAt !== null;

  /*
   * Written from figures this person may no longer read: the server sent no
   * content, so there is nothing to copy, download or rate. It can still be
   * unsaved, because anything saved can always be unsaved.
   */
  if (answer.withheld) {
    return (
      <div className="bg-muted/60 max-w-full space-y-2.5 rounded-2xl rounded-bl-md px-3.5 py-3 text-sm sm:max-w-[92%]">
        <p className="text-muted-foreground flex items-start gap-1.5">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("assistantPage.answerWithheld")}
        </p>
        {saved && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(ACTION, "text-primary")}
            onClick={() => onSave(answer, false)}
            disabled={saving}
            aria-pressed
          >
            <BookmarkCheck className="size-3.5" />
            {t("assistantPage.saved")}
          </Button>
        )}
      </div>
    );
  }

  function copy() {
    if (!navigator.clipboard) {
      toast.error(t("assistantPage.copyFailed"));
      return;
    }
    navigator.clipboard.writeText(answer.content).then(
      () => toast.success(t("assistantPage.copied")),
      (e: unknown) => {
        // Denied by the browser (an insecure origin, or the page not focused).
        console.error("[assistant] copy failed", e);
        toast.error(t("assistantPage.copyFailed"));
      },
    );
  }

  function downloadMarkdown() {
    const body = chatMarkdown({
      title: conversationTitle || t("assistantPage.untitled"),
      exchanges: [{ question, answer }],
      labels: {
        question: t("assistantPage.question"),
        answer: t("assistantPage.answer"),
        sources: t("assistantPage.sources"),
        sourceTitle: (s) => sourceTitle(t, s),
        leftOut: (count) => t("assistantPage.answersLeftOut", { count }),
      },
    });
    downloadText(body, markdownFilename(new Date()));
  }

  const advisor = answer.mode === "advisor";
  return (
    <div className="bg-muted/60 max-w-full space-y-2.5 rounded-2xl rounded-bl-md px-3.5 py-3 text-sm sm:max-w-[92%]">
      {/*
        Which kind of answer this is, on the answer itself: one chat can hold
        both (the advisor falls back to the guides when the figures cannot be
        built, or after a plan, role or consent change), and the header's
        badge only says what the NEXT question gets.
      */}
      {answered && (
        <p
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
            advisor ? "bg-primary/10 text-primary" : "bg-background text-foreground",
          )}
          title={advisor ? t("assistantPage.modeAdvisorHint") : t("assistantPage.modeHelpHint")}
        >
          {advisor ? <Sparkles className="size-3" aria-hidden /> : <BookOpen className="size-3" aria-hidden />}
          {advisor ? t("assistantPage.modeAdvisor") : t("assistantPage.modeHelp")}
        </p>
      )}
      {answered ? (
        // Paths link only in the church shell, for the same reason as the source chips below.
        <AssistantAnswer linkable={scope === "church"}>{answer.content}</AssistantAnswer>
      ) : (
        <p className={cn(answer.kind === "out_of_scope" && "text-muted-foreground")}>{answer.content}</p>
      )}

      {answered && answer.figuresOk === false && (
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("assistantPage.figuresNote")}
        </p>
      )}

      {answered && answer.sources.length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-semibold">
            {answer.mode === "advisor" ? t("assistantPage.sources") : t("assistant.fromTheGuides")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {answer.sources.map((s) =>
              /*
               * Guide chips link only in the church shell. /help/<slug> lives
               * behind requireChurch, which sends a superadmin without a seat
               * of their own straight back to /superadmin.
               */
              s.href && scope === "church" ? (
                <Link
                  key={s.ref}
                  href={s.href}
                  className="bg-background hover:border-primary inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium sm:min-h-8"
                >
                  {sourceTitle(t, s)}
                </Link>
              ) : (
                <span key={s.ref} className="bg-background inline-flex items-center rounded-full border px-2.5 py-1 text-xs">
                  {sourceTitle(t, s)}
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {answered && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Button variant="ghost" size="sm" className={ACTION} onClick={copy} aria-label={t("assistantPage.copy")}>
            <Copy className="size-3.5" />
            <span className="max-sm:sr-only">{t("assistantPage.copy")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(ACTION, saved && "text-primary")}
            onClick={() => onSave(answer, !saved)}
            disabled={saving}
            aria-pressed={saved}
          >
            {saved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
            {saved ? t("assistantPage.saved") : t("assistantPage.save")}
          </Button>
          {conversationId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className={ACTION} aria-label={t("assistantPage.download")}>
                  <Download className="size-3.5" />
                  <span className="max-sm:sr-only">{t("assistantPage.download")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuItem
                  onSelect={() => void downloadPdf(pdfHref(links.exportBase, conversationId, answer.id), t)}
                >
                  <FileDown />
                  {t("assistantPage.answerPdf")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={downloadMarkdown}>
                  <FileText />
                  {t("assistantPage.answerMarkdown")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />

          {rated === "thanks" || (answer.helpful === true && !rated) ? (
            <p className="text-muted-foreground text-xs">{t("assistant.thanksForFeedback")}</p>
          ) : rated === "sorry" || answer.helpful === false ? (
            <p className="text-muted-foreground text-xs">
              {t("assistant.sorryNotHelpful")}
              {links.support && (
                <>
                  {" "}
                  <Link href={links.support} className="text-primary font-medium underline">
                    {t("assistant.openSupportTicket")}
                  </Link>
                </>
              )}
            </p>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">{t("assistant.didThisHelp")}</span>
              <Button variant="outline" size="sm" className={ACTION} onClick={() => onRate(answer.id, true)}>
                <ThumbsUp className="size-3.5" />
                {t("assistant.yes")}
              </Button>
              <Button variant="outline" size="sm" className={ACTION} onClick={() => onRate(answer.id, false)}>
                <ThumbsDown className="size-3.5" />
                {t("assistant.no")}
              </Button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
