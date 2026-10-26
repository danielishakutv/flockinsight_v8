import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { canReadChurchSummary } from "@/lib/ai/ai-shared";
import { getChurchBrand } from "@/lib/pdf-brand";
import { churchShellAsker } from "@/lib/assistant/asker";
import { assistantPdfResponse } from "@/lib/assistant/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /assistant/export?c=<conversationId>[&m=<messageId>][&format=pdf]
 *
 * A PDF of one of the signed-in person's own assistant conversations, or of
 * one answer in it. The assistant has no permission key (any staff login may
 * ask), so what decides access is ownership: the conversation is read through
 * the core's tenancy predicate, and anybody else's, or a deleted one, is a
 * 404 indistinguishable from an id that never existed.
 *
 * A superadmin acting as this church is "actingAs" to the core: their
 * conversations here are platform-scope support chats about this church, the
 * same ones the chat page shows them, never the church's own staff's.
 *
 * No plan gate: a download is a read, and reads keep working off-plan.
 */
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const asker = await churchShellAsker();

  /*
   * The permission question every church route asks
   * (route-permission-guard.test.ts), and here it has a real answer to give:
   * whether this person may still read the figures an advisor answer was
   * written from. It is the same gate the advisor itself and the summaries
   * use. An admin acting as the church holds every permission, so it is yes.
   */
  const mayReadFigures = canReadChurchSummary(await getAccess());

  return assistantPdfResponse({
    request,
    asker,
    // The church's own paperwork: its name always, its logo and colours on Pro.
    brand: () => getChurchBrand(church),
    timeZone: church.timezone,
    mayReadFigures,
  });
}
