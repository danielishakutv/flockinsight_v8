import Link from "next/link";
import { format } from "date-fns";
import type { AiCallStatus, AiFeature } from "@/db/schema";
import { formatNanoUsd } from "@/lib/ai/pricing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type AiCallRow = {
  id: string;
  createdAt: string;
  churchId: string | null;
  churchName: string | null;
  feature: AiFeature;
  model: string;
  servedModel: string | null;
  status: AiCallStatus;
  inputTokens: number | null;
  outputTokens: number | null;
  costNano: number | null;
  reservedNano: number;
};

const STATUS_TONE: Record<AiCallStatus, string> = {
  reserved: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  refused: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  truncated: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  abandoned: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function Chip({ status }: { status: AiCallStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[status])}>
      {status}
    </span>
  );
}

function who(r: AiCallRow): string {
  if (!r.churchId) return "Platform";
  return r.churchName ?? "Deleted church";
}

function modelLine(r: AiCallRow): string {
  return r.servedModel && r.servedModel !== r.model ? `${r.model} → ${r.servedModel}` : r.model;
}

function cost(r: AiCallRow): string {
  return r.costNano === null ? `${formatNanoUsd(r.reservedNano)} held` : formatNanoUsd(r.costNano);
}

/**
 * The last 50 calls. A GET form filters by feature, status and church, so a
 * filtered view is a link that can be shared. Rows become stacked cards on a
 * phone rather than a table that scrolls the page sideways.
 */
export function AiCallsTable({
  rows,
  filters,
  features,
  statuses,
  dormant,
}: {
  rows: AiCallRow[];
  filters: { feature?: AiFeature; status?: AiCallStatus; church?: string };
  features: AiFeature[];
  statuses: AiCallStatus[];
  dormant: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent calls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form method="get" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Feature
            <select name="feature" defaultValue={filters.feature ?? ""} className="bg-background h-9 rounded-lg border px-2 text-sm">
              <option value="">All</option>
              {features.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Status
            <select name="status" defaultValue={filters.status ?? ""} className="bg-background h-9 rounded-lg border px-2 text-sm">
              <option value="">All</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Church id
            <input
              name="church"
              defaultValue={filters.church ?? ""}
              placeholder="Any"
              className="bg-background h-9 rounded-lg border px-2 text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>

        {rows.length === 0 ? (
          <div className="text-muted-foreground space-y-1 py-6 text-center text-sm">
            <p>No AI calls yet.</p>
            {dormant && <p>AI is dormant: set ANTHROPIC_API_KEY on the server and restart with --update-env.</p>}
          </div>
        ) : (
          <>
            {/* Phone: stacked cards */}
            <div className="space-y-2 md:hidden">
              {rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/superadmin/ai/calls/${r.id}`}
                  className="hover:bg-muted/50 block rounded-xl border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{who(r)}</span>
                    <Chip status={r.status} />
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {format(new Date(r.createdAt), "MMM d, HH:mm")} · {r.feature} · {modelLine(r)}
                  </p>
                  <p className="mt-1 text-xs tabular-nums">
                    {r.inputTokens ?? "—"} in / {r.outputTokens ?? "—"} out · {cost(r)}
                  </p>
                </Link>
              ))}
            </div>
            {/* Wider: a table, scrolling inside its own box if it must */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Church</th>
                    <th className="py-2 pr-3 font-medium">Feature</th>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 text-right font-medium">Tokens in / out</th>
                    <th className="py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Link href={`/superadmin/ai/calls/${r.id}`} className="hover:underline">
                          {format(new Date(r.createdAt), "MMM d, HH:mm")}
                        </Link>
                      </td>
                      <td className="max-w-48 truncate py-2 pr-3">
                        {r.churchId && r.churchName ? (
                          <Link href={`/superadmin/churches/${r.churchId}`} className="hover:underline">
                            {r.churchName}
                          </Link>
                        ) : (
                          who(r)
                        )}
                      </td>
                      <td className="py-2 pr-3">{r.feature}</td>
                      <td className="py-2 pr-3 text-xs">{modelLine(r)}</td>
                      <td className="py-2 pr-3">
                        <Chip status={r.status} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.inputTokens ?? "—"} / {r.outputTokens ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">{cost(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
