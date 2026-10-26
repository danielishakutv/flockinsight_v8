import "server-only";

import type { ChurchBrand } from "@/lib/pdf-brand";
import { rateLimit } from "@/lib/rate-limit";
import { formatDateTime } from "@/lib/i18n/formatting";
import { renderAssistantPdf, type AssistantPdfItem } from "@/lib/assistant-pdf";
import { loadConversation } from "@/lib/assistant/chat";
import { exchangesOf, type ChatAnswer, type ChatQuestion } from "@/lib/assistant/shared";
import type { AssistantAsker } from "@/lib/assistant/owner";

/*
 * The download behind both shells' "Download PDF": the church page's
 * /assistant/export and the superadmin's /superadmin/ask/export. The routes
 * decide who is asking (and so which conversations exist for them) and whose
 * brand the PDF wears; everything after that is the same and lives here, so
 * the ownership rule and the figures rule cannot drift apart between them.
 *
 *   GET ?c=<conversationId>                    the whole conversation
 *   GET ?c=<conversationId>&m=<messageId>      one answer and its question
 *   &format=pdf                                optional; the only format
 *
 * Markdown downloads are made in the browser from what the page already has,
 * so they never come here.
 */

/** Rendering is the cost being guarded, not a secret: ten a minute is plenty for a person. */
export const EXPORT_RATE_LIMIT = { count: 10, windowMs: 60_000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * One answer for everything that is not theirs: a foreign id, a deleted
 * conversation, a malformed one, an answer from some other conversation.
 * The same words and status every time, so the route cannot be used to ask
 * whether a conversation exists.
 */
const NOT_FOUND = "Not found.";

export type ExportQuery = { conversationId: string; messageId: string | null };

/** The query, or the plain-text refusal for a request that is malformed rather than unknown. */
export function readExportQuery(params: URLSearchParams): ExportQuery | { status: 400 | 404; message: string } {
  const format = params.get("format");
  if (format !== null && format !== "pdf") return { status: 400, message: "Only format=pdf can be downloaded." };
  const c = params.get("c");
  if (!c) return { status: 400, message: "Say which conversation to download: ?c=<id>." };
  const m = params.get("m");
  if (!UUID.test(c) || (m !== null && !UUID.test(m))) return { status: 404, message: NOT_FOUND };
  return { conversationId: c, messageId: m };
}

type Exchange = { question: ChatQuestion | null; answer: ChatAnswer };

/**
 * Which exchanges go in the PDF, and how many were left out for the figures.
 *
 * An advisor answer is written from the church's figures (or the platform's)
 * and carries them: attendance and follow-up counts, the giving trend. A PDF
 * is the copy that leaves, gets printed and gets forwarded, so it follows
 * the rule the summary report follows: only someone who may read those
 * figures today takes them away. The advisor only ever answered people who
 * could, so this bites only when a role was narrowed after the question;
 * the help answers in the same conversation still download, with a line
 * saying what was left out, so a missing answer never reads as no answer.
 * The page and the Markdown download follow the same rule: loadConversation
 * already hands such an answer over withheld (chat.ts mayReadFigures), and
 * this is the second lock on the same door.
 */
export function exchangesForPdf(
  all: readonly Exchange[],
  input: { messageId: string | null; mayReadFigures: boolean },
): { kept: Exchange[]; withheld: number; found: boolean } {
  const chosen = input.messageId ? all.filter((e) => e.answer.id === input.messageId) : [...all];
  if (input.messageId && chosen.length === 0) return { kept: [], withheld: 0, found: false };
  if (input.mayReadFigures) return { kept: chosen, withheld: 0, found: true };
  const kept = chosen.filter((e) => e.answer.mode !== "advisor");
  return { kept, withheld: chosen.length - kept.length, found: true };
}

/**
 * The zone to print times in. A zone Intl does not know (a hand-edited
 * church row) would throw inside every date below and turn a download into
 * a 500, so it falls back to UTC, which the PDF then says it is in.
 */
export function printableZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch (e) {
    console.error("[assistant] export: unknown time zone, printing in UTC", timeZone, e instanceof Error ? e.message : e);
    return "UTC";
  }
}

/** `flockinsight-assistant-2026-10-25.pdf`, dated in the zone the PDF is printed in (pass a printableZone). */
export function exportFilename(now: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `flockinsight-assistant-${day}.pdf`;
}

function text(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", ...headers },
  });
}

function toPdfItem(e: Exchange): AssistantPdfItem {
  return {
    question: e.question?.content ?? null,
    answer: e.answer.content,
    mode: e.answer.mode,
    createdAt: e.answer.createdAt,
    figuresOk: e.answer.figuresOk,
    sources: e.answer.sources.map((src) => ({ title: src.title, href: src.href })),
  };
}

/**
 * The whole download, once the route has said who is asking.
 *
 * Ownership is the core's: loadConversation reads through the one tenancy
 * predicate (this person, this scope, this church or none, the church an
 * admin was acting as or none, not deleted), so a conversation that is not
 * the asker's is simply not found.
 */
export async function assistantPdfResponse(input: {
  request: Request;
  asker: AssistantAsker;
  /**
   * Whose name the PDF wears. A loader, not a value: a church's brand may
   * fetch its logo, which is not worth doing for a request that turns out
   * to be a 404 or over the limit.
   */
  brand: () => Promise<ChurchBrand>;
  /** The church's own zone, or "UTC" on the platform side. */
  timeZone: string;
  /** Whether this person may read, today, the figures advisor answers were written from. */
  mayReadFigures: boolean;
}): Promise<Response> {
  const { asker } = input;

  // One bucket per person across both shells: it is the same renderer.
  const limit = rateLimit(`assistant-pdf:${asker.userId}`, EXPORT_RATE_LIMIT.count, EXPORT_RATE_LIMIT.windowMs);
  if (!limit.ok) {
    return text(429, `Too many downloads. Try again in ${limit.retryAfterSec} seconds.`, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const query = readExportQuery(new URL(input.request.url).searchParams);
  if ("status" in query) return text(query.status, query.message);

  const loaded = await loadConversation({ asker, conversationId: query.conversationId });
  if (!loaded) return text(404, NOT_FOUND);

  const picked = exchangesForPdf(exchangesOf(loaded.items), {
    messageId: query.messageId,
    mayReadFigures: input.mayReadFigures,
  });
  if (!picked.found) return text(404, NOT_FOUND);
  if (picked.kept.length === 0 && picked.withheld > 0) {
    return text(
      403,
      "This answer was written from the figures, and your role no longer includes them, so it cannot be downloaded.",
    );
  }

  const now = new Date();
  const zone = printableZone(input.timeZone);
  const generated = `${formatDateTime(now, "en", zone)}${zone === "UTC" ? " UTC" : ""}`;
  const context = loaded.conversation.contextChurch;

  let pdf: Buffer;
  try {
    pdf = await renderAssistantPdf({
      brand: await input.brand(),
      title: loaded.conversation.title,
      scopeLabel: query.messageId ? "Assistant answer" : "Assistant conversation",
      generated,
      timeZone: zone,
      items: picked.kept.map(toPdfItem),
      // A copy made while acting as a church says so, so it is never taken for the church's own.
      subtitle: context ? `Asked by FlockInsight support while acting as ${context.name}` : null,
      notice:
        picked.withheld > 0
          ? `${picked.withheld} ${picked.withheld === 1 ? "answer was" : "answers were"} left out: ${picked.withheld === 1 ? "it was" : "they were"} written from the figures, and your role no longer includes them.`
          : null,
    });
  } catch (e) {
    /*
     * Logged with what identifies the request and nothing of its content:
     * the conversation is somebody's questions, and a render failure is
     * about the document, not the words.
     */
    console.error(
      "[assistant] export: PDF render failed",
      { conversationId: query.conversationId, messageId: query.messageId, items: picked.kept.length },
      e instanceof Error ? e.stack ?? e.message : e,
    );
    return text(500, "The PDF could not be made. Try again, or download the Markdown instead.");
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${exportFilename(now, zone)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
