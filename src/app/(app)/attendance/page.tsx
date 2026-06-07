import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import {
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Plus,
} from "lucide-react";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const { church } = await requireChurch();

  const rows = await db
    .select({
      id: attendanceSession.id,
      date: attendanceSession.date,
      title: attendanceSession.title,
      serviceName: service.name,
      total: attendanceSession.totalCount,
      male: attendanceSession.maleCount,
      female: attendanceSession.femaleCount,
      children: attendanceSession.childrenCount,
      firstTimers: attendanceSession.firstTimerCount,
      newConverts: attendanceSession.newConvertCount,
    })
    .from(attendanceSession)
    .leftJoin(service, eq(service.id, attendanceSession.serviceId))
    .where(eq(attendanceSession.churchId, church.id))
    .orderBy(desc(attendanceSession.date), desc(attendanceSession.createdAt));

  // group by "MMMM yyyy"
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = format(parseISO(r.date), "MMMM yyyy");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Attendance"
        description={`${rows.length} recorded ${rows.length === 1 ? "service" : "services"}`}
        action={
          <>
            {rows.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg">
                    <Download className="size-5" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem asChild>
                    <Link href="/reports/attendance" target="_blank">
                      <FileText className="size-4" />
                      PDF report
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href="/attendance/export" download>
                      <FileSpreadsheet className="size-4" />
                      Download CSV
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button asChild size="lg">
              <Link href="/attendance/record">
                <Plus className="size-5" />
                Record
              </Link>
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <div className="bg-muted/40 mt-6 grid place-items-center gap-4 rounded-2xl border border-dashed p-12 text-center">
          <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
            <ClipboardList className="size-8" />
          </div>
          <div>
            <p className="text-lg font-semibold">No attendance yet</p>
            <p className="text-muted-foreground text-sm">
              Record your first service to see it here.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/attendance/record">
              <Plus className="size-5" />
              Record attendance
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([month, items]) => (
            <section key={month}>
              <h2 className="text-muted-foreground mb-2 px-1 text-xs font-bold uppercase tracking-wider">
                {month}
              </h2>
              <div className="space-y-2">
                {items.map((r) => {
                  const d = parseISO(r.date);
                  return (
                    <Link
                      key={r.id}
                      href={`/attendance/${r.id}/edit`}
                      className="bg-card hover:border-primary/40 flex items-center gap-4 rounded-2xl border p-3 shadow-sm transition-colors sm:p-4"
                    >
                      {/* date block */}
                      <div className="bg-muted grid size-14 shrink-0 place-items-center rounded-xl text-center leading-none">
                        <span className="text-muted-foreground text-[10px] font-bold uppercase">
                          {format(d, "EEE")}
                        </span>
                        <span className="text-xl font-extrabold">
                          {format(d, "d")}
                        </span>
                      </div>

                      {/* service + breakdown */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">
                          {r.serviceName ?? r.title ?? "Event"}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="secondary">M {r.male}</Badge>
                          <Badge variant="secondary">W {r.female}</Badge>
                          <Badge variant="secondary">C {r.children}</Badge>
                          {r.firstTimers > 0 && (
                            <Badge variant="outline">
                              {r.firstTimers} first-timer
                              {r.firstTimers === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* total */}
                      <div className="text-right">
                        <div className="text-2xl font-extrabold tabular-nums sm:text-3xl">
                          {r.total}
                        </div>
                        <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                          total
                        </div>
                      </div>
                      <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
