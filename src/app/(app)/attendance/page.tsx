import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AttendanceExportMenu } from "@/components/attendance/export-menu";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const { church, user } = await requireChurch();
  await requireCan("attendance.view");
  const canManage = await can("attendance.manage");

  const rows = await db
    .select({
      id: attendanceSession.id,
      date: attendanceSession.date,
      title: attendanceSession.title,
      serviceName: service.name,
      total: attendanceSession.totalCount,
      male: attendanceSession.maleCount,
      female: attendanceSession.femaleCount,
      teenMale: attendanceSession.teenMaleCount,
      teenFemale: attendanceSession.teenFemaleCount,
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
            <AttendanceExportMenu
              userEmail={user.email}
              hasData={rows.length > 0}
              canManage={canManage}
            />
            {canManage && (
              <Button asChild size="lg">
                <Link href="/attendance/record">
                  <Plus className="size-5" />
                  Record
                </Link>
              </Button>
            )}
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
          {canManage && (
            <Button asChild size="lg">
              <Link href="/attendance/record">
                <Plus className="size-5" />
                Record attendance
              </Link>
            </Button>
          )}
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
                          <Badge variant="secondary">
                            Adults {r.male + r.female}
                          </Badge>
                          <Badge variant="secondary">
                            Teens {r.teenMale + r.teenFemale}
                          </Badge>
                          <Badge variant="secondary">
                            Children {r.children}
                          </Badge>
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
