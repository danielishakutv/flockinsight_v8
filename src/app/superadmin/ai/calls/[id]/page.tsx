import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/db";
import { aiCall, church, user } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { formatNanoUsd } from "@/lib/ai/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "AI call · Admin" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch (e) {
    // Stored before the call, so it should always parse; show it raw if not.
    console.error("[ai] stored requestJson is not valid JSON", e instanceof Error ? e.message : e);
    return json;
  }
}

/**
 * One call: exactly what was sent (as text, never HTML), what came back, and
 * what it cost. The request JSON is the record that has to be produced if
 * anyone ever asks what left the server.
 */
export default async function AiCallPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatform("platform.ai.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [row] = await db
    .select({ call: aiCall, actorName: user.name })
    .from(aiCall)
    .leftJoin(user, eq(user.id, aiCall.actorUserId))
    .where(eq(aiCall.id, id))
    .limit(1);
  if (!row) notFound();
  const c = row.call;
  const [owner] = c.churchId
    ? await db.select({ name: church.name }).from(church).where(eq(church.id, c.churchId)).limit(1)
    : [];

  const meta: [string, React.ReactNode][] = [
    ["When", format(c.createdAt, "MMM d, yyyy HH:mm:ss")],
    [
      "Church",
      c.churchId ? (
        owner ? (
          <Link href={`/superadmin/churches/${c.churchId}`} className="hover:underline">
            {owner.name}
          </Link>
        ) : (
          `Deleted church (${c.churchId})`
        )
      ) : (
        "Platform"
      ),
    ],
    ["Requested by", row.actorName ?? "—"],
    ["Feature", c.feature],
    ["Prompt", c.promptId],
    ["Payload schema", c.payloadSchema ?? "—"],
    ["Model", c.servedModel && c.servedModel !== c.model ? `${c.model} → ${c.servedModel}` : c.model],
    ["Status", c.status],
    ["Stop reason", c.stopReason ?? "—"],
    ["Refusal category", c.refusalCategory ?? "—"],
    ["Tokens", `${c.inputTokens ?? "—"} in · ${c.outputTokens ?? "—"} out · ${c.cacheWriteTokens ?? 0} cache write · ${c.cacheReadTokens ?? 0} cache read`],
    ["Reserved", formatNanoUsd(c.reservedNano, 6)],
    ["Cost", c.costNano === null ? "Not settled" : formatNanoUsd(c.costNano, 6)],
    ["Duration", c.durationMs === null ? "—" : `${(c.durationMs / 1000).toFixed(1)} s`],
    ["Budget month", c.budgetMonth],
    ["Provider request id", c.providerRequestId ?? "—"],
    ["Request sha256", <span key="sha" className="break-all font-mono text-xs">{c.requestSha256}</span>],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/superadmin/ai">
            <ArrowLeft className="size-4" />
            AI
          </Link>
        </Button>
        <Button asChild size="sm">
          <a href={`/superadmin/ai/calls/${c.id}/download`}>
            <Download className="size-4" />
            Download JSON
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base break-all">Call {c.id}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
            {meta.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {c.error && <p className="text-destructive mt-3 text-sm break-words">{c.error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What was sent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted max-h-[32rem] overflow-auto rounded-xl">
            <pre className="p-3 text-xs leading-relaxed">{pretty(c.requestJson)}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What came back</CardTitle>
        </CardHeader>
        <CardContent>
          {c.responseText ? (
            <div className="bg-muted max-h-[32rem] overflow-auto rounded-xl">
              <pre className="p-3 text-sm leading-relaxed whitespace-pre-wrap">{c.responseText}</pre>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No text came back.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
