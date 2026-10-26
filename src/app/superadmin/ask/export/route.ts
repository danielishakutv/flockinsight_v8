import { platformShellAsker } from "@/lib/assistant/asker";
import { assistantPdfResponse } from "@/lib/assistant/export";
import { flockInsightPdfBrand } from "@/lib/assistant-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /superadmin/ask/export?c=<conversationId>[&m=<messageId>][&format=pdf]
 *
 * The superadmin's own /superadmin/ask conversations as a PDF. Any admin may
 * use the page, so any admin may download from it, and only their own
 * conversations: platform scope, no church, no church acted as. Their
 * support chats while acting as a church download from that church's
 * /assistant/export instead, which is where they were asked.
 *
 * Somebody who is not an admin gets the same 404 as an unknown id: nothing
 * here should say that the route, or anything behind it, exists.
 */
export async function GET(request: Request) {
  const asker = await platformShellAsker();
  if (!asker) {
    return new Response("Not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  return assistantPdfResponse({
    request,
    asker,
    // There is no church to lead with, so the PDF wears ours.
    brand: async () => flockInsightPdfBrand(),
    // Platform conversations have no church clock; the PDF says it is UTC.
    timeZone: "UTC",
    // The platform advisor's figures sit behind platform.overview.view.
    mayReadFigures: asker.kind === "platform" && asker.canReadFigures,
  });
}
