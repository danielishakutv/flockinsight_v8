import Link from "next/link";
import { Church } from "lucide-react";
import {
  listDenominations,
  unassignedChurchCount,
} from "@/lib/denominations";
import { DenominationDialog } from "@/components/superadmin/denomination-dialog";
import { DenominationRowActions } from "@/components/superadmin/denomination-row-actions";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Denominations · Admin" };
export const dynamic = "force-dynamic";

export default async function DenominationsPage() {
  const [rows, unassigned] = await Promise.all([
    listDenominations(),
    unassignedChurchCount(),
  ]);

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  const grouped = active.reduce((sum, r) => sum + r.churches, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Denominations</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Group churches by the body they belong to, then reach a whole group
            at once from Outreach.
          </p>
        </div>
        <DenominationDialog />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-3">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase">
              Denominations
            </p>
            <p className="text-xl font-bold tabular-nums">{active.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase">
              Churches grouped
            </p>
            <p className="text-xl font-bold tabular-nums">{grouped}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase">
              Not yet grouped
            </p>
            <p className="text-xl font-bold tabular-nums">{unassigned}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {active.length === 0 ? (
            <div className="text-muted-foreground px-4 py-12 text-center">
              <Church className="mx-auto mb-2 size-7 opacity-40" />
              <p className="text-sm font-medium">No denominations yet</p>
              <p className="text-xs">
                Create one — RCCG, Anglican, COCIN — then add the churches that
                belong to it.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {active.map((d) => (
                <li
                  key={d.id}
                  className="hover:bg-accent/30 flex items-center gap-3 px-4 py-2.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/superadmin/denominations/${d.id}`}
                      className="hover:text-primary text-sm font-semibold"
                    >
                      {d.name}
                      {d.abbreviation ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {d.abbreviation}
                        </span>
                      ) : null}
                    </Link>
                    {d.notes && (
                      <p className="text-muted-foreground truncate text-xs">
                        {d.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {d.churches} church{d.churches === 1 ? "" : "es"}
                  </span>
                  <DenominationRowActions
                    denomination={{
                      id: d.id,
                      name: d.name,
                      abbreviation: d.abbreviation ?? "",
                      notes: d.notes ?? "",
                    }}
                    others={active
                      .filter((o) => o.id !== d.id)
                      .map((o) => ({ id: o.id, name: o.name }))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {archived.length > 0 && (
        <Card>
          <CardContent className="space-y-2 py-3">
            <p className="text-muted-foreground text-[11px] font-semibold uppercase">
              Archived ({archived.length})
            </p>
            <ul className="space-y-1">
              {archived.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    {d.name}
                    {d.churches > 0 ? ` · still holds ${d.churches}` : ""}
                  </span>
                  <DenominationRowActions
                    denomination={{
                      id: d.id,
                      name: d.name,
                      abbreviation: d.abbreviation ?? "",
                      notes: d.notes ?? "",
                    }}
                    others={active.map((o) => ({ id: o.id, name: o.name }))}
                    archived
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
