import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";
import { db } from "@/db";
import { supportTicket, church } from "@/db/schema";
import { categoryLabel } from "@/lib/support";
import { TicketStatusBadge } from "@/components/help/ticket-thread";
import { cn } from "@/lib/utils";

import { requirePlatform } from "@/lib/platform-access";
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
  await requirePlatform("platform.support.manage");
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

      <div className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Link
              key={f.key}
              href={`/superadmin/support?status=${f.key}`}
              className={cn(
                "relative shrink-0 px-3 py-2 text-sm font-semibold transition-colors",
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
              className="bg-card flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition hover:shadow-md"
            >
              {/* The subject gets the width and two lines; who, where and
                  when go underneath rather than beside it. */}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 leading-snug font-semibold break-words">
                  {t.subject}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <TicketStatusBadge status={t.status} audience="admin" />
                  <span className="text-muted-foreground text-xs">
                    {format(parseISO(t.lastReplyAt.toISOString()), "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs font-medium">{t.churchName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {t.contactName ?? "—"} · {categoryLabel(t.category)}
                </p>
              </div>
              <ChevronRight className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
