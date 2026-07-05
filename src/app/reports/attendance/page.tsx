import { Church } from "lucide-react";
import { format, parseISO } from "date-fns";
import { requireChurch } from "@/lib/session";
import {
  getAttendanceRows,
  summarizeAttendance,
} from "@/lib/attendance-export";
import { ReportToolbar } from "@/components/attendance/report-toolbar";

export const metadata = { title: "Attendance Report" };

function fmt(date: string) {
  return format(parseISO(date), "MMM d, yyyy");
}

function StatTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl border border-violet-200 bg-violet-50 p-4"
          : "rounded-xl border border-slate-200 bg-white p-4"
      }
    >
      <div
        className={
          accent
            ? "text-3xl font-extrabold tabular-nums text-violet-700"
            : "text-3xl font-extrabold tabular-nums text-slate-900"
        }
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}

export default async function AttendanceReportPage() {
  const { church } = await requireChurch();
  const rows = await getAttendanceRows(church.id);
  const s = summarizeAttendance(rows);

  const period =
    s.firstDate && s.lastDate
      ? s.firstDate === s.lastDate
        ? fmt(s.lastDate)
        : `${fmt(s.firstDate)} — ${fmt(s.lastDate)}`
      : "No records yet";
  const generated = format(new Date(), "MMM d, yyyy 'at' h:mm a");

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      {/* Print rules: exact colors, clean page margins, hide the toolbar. */}
      <style>{`
        @page { size: A4; margin: 13mm; }
        @media print {
          html, body { background: #ffffff !important; }
          .no-print { display: none !important; }
          .report-sheet { box-shadow: none !important; margin: 0 !important; }
          tr { break-inside: avoid; }
          thead { display: table-header-group; }
        }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <ReportToolbar />

      <div className="report-sheet mx-auto max-w-4xl px-5 pb-16 print:px-0">
        {/* Church-forward header band */}
        <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#6d28d9] to-[#8b5cf6] text-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 p-6 sm:p-8">
            <div className="flex items-center gap-4">
              {church.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={church.logo}
                  alt={church.name}
                  className="size-14 rounded-xl bg-white/10 object-cover"
                />
              ) : (
                <div className="grid size-14 place-items-center rounded-xl bg-white/15">
                  <Church className="size-7" strokeWidth={2.2} />
                </div>
              )}
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
                  Attendance Report
                </p>
                <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">
                  {church.name}
                </h1>
              </div>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold">{period}</p>
              <p className="text-white/70">
                {s.sessions} {s.sessions === 1 ? "service" : "services"} recorded
              </p>
            </div>
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="mt-10 text-center text-slate-500">
            No attendance has been recorded yet.
          </p>
        ) : (
          <>
            {/* Headline stats */}
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total attendance" value={s.total} accent />
              <StatTile label="Avg / service" value={s.average} />
              <StatTile label="Peak service" value={s.peak} />
              <StatTile label="Services" value={s.sessions} />
            </section>

            {/* Composition */}
            <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile label="Men" value={s.male} />
              <StatTile label="Women" value={s.female} />
              <StatTile label="Teens" value={s.teens} />
              <StatTile label="Children" value={s.children} />
              <StatTile label="First-timers" value={s.firstTimers} />
              <StatTile label="New converts" value={s.newConverts} />
            </section>

            {/* Detailed table */}
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Service-by-service
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                      <th className="px-3 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Service / Event</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Men</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Women</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Teens</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Children</th>
                      <th className="px-3 py-2.5 text-right font-semibold">First</th>
                      <th className="px-3 py-2.5 text-right font-semibold">New</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.date}-${i}`}
                        className={
                          i % 2 === 0
                            ? "border-t border-slate-100 bg-white"
                            : "border-t border-slate-100 bg-slate-50"
                        }
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                          {fmt(r.date)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {r.name}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.male}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.female}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.teenMale + r.teenFemale}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.children}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.firstTimers}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {r.newConverts}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                          {r.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-900">
                      <td className="px-3 py-2.5" colSpan={2}>
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.male}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.female}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.teens}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.children}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.firstTimers}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.newConverts}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.total}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        )}

        {/* Subtle footer — minimal platform branding */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <span>
            {church.name} · Generated {generated}
          </span>
          <span>Powered by FlockInsight</span>
        </footer>
      </div>
    </div>
  );
}
