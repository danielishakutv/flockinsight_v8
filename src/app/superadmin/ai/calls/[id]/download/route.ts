import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aiCall } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requirePlatform } from "@/lib/platform-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /superadmin/ai/calls/[id]/download -> exactly what one AI call sent, and
// what came back, as a JSON file. The "produce what was sent" button.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatform("platform.ai.view");
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found: that is not an AI call id.", { status: 404 });

  const [c] = await db.select().from(aiCall).where(eq(aiCall.id, id)).limit(1);
  if (!c) return new Response("Not found: no AI call has that id.", { status: 404 });

  let request: unknown;
  try {
    request = JSON.parse(c.requestJson);
  } catch (e) {
    // Written by runAi before the call, so this should never happen; the raw
    // text is still the record, so hand it over rather than refuse.
    console.error("[ai] stored requestJson is not valid JSON", { id }, e instanceof Error ? e.message : e);
    request = c.requestJson;
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "platform.ai_payload.download",
    summary: `Downloaded the payload of AI call ${id}`,
    targetType: "ai_call",
    targetId: id,
    // No churchId: the call may outlive its church, and the audit row must
    // not fail to write because that church is gone.
    meta: { churchId: c.churchId, feature: c.feature },
  });

  const { requestJson: _raw, responseText, ...meta } = c;
  void _raw;
  const body = { call: meta, request, responseText };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-call-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
