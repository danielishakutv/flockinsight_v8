import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { db } from "@/db";
import { supportTicket, church } from "@/db/schema";
import { categoryLabel } from "@/lib/support";
import { TicketStatusBadge } from "@/components/help/ticket-thread";
import { cn } from "@/lib/utils";

export const metadata = { title: "Support · Admin" };

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "open", label: "Needs reply" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default async function SuperadminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filter = "active" } = await searchParams;

  const rows = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      category: supportTicket.category,
      status: supportTicket.status,
      lastReplyAt: supportTicket.lastReplyAt,
      contactName: supportTicket.contactName,
      churchName: church.name,
    })
    .from(supportTicket)
    .innerJoin(church, eq(church.id, supportTicket.churchId))
    .orderBy(desc(supportTicket.lastReplyAt))
    .limit(300);

  const visible = rows.filter((t) =>
    filter === "all"
      ? true
      : filter === "active"
        ? t.status !== "closed"
        : t.status === filter,
  );
  const openCount = rows.filter((t) => t.status === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Support
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {openCount} ticket{openCount === 1 ? "" : "s"} need a reply.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Link
              key={f.key}
              href={`/superadmin/support?status=${f.key}`}
              className={cn(
                "relative px-3 py-2 text-sm font-semibold transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              {active && (
                <span className="bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full" />
              )}
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No tickets here.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((t) => (
            <Link
              key={t.id}
              href={`/superadmin/support/${t.id}`}
              className="bg-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{t.subject}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {t.churchName} · {t.contactName ?? "—"} ·{" "}
                  {categoryLabel(t.category)} ·{" "}
                  {format(parseISO(t.lastReplyAt.toISOString()), "MMM d, h:mm a")}
                </p>
              </div>
              <TicketStatusBadge status={t.status} audience="admin" />
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
