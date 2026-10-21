import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { parseCsv, unescapeCsvCell } from "@/lib/csv";
import { normalizeDate } from "@/lib/members-data";
import {
  ATTENDANCE_BAND_FIELDS,
  headerToAttendanceField,
  normalizeCount,
  oneOffSessionKey,
  resolveImportedBands,
  type AttendanceBandField,
  type AttendanceFieldKey,
} from "@/lib/attendance-data";

const MAX_ROWS = 3000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /attendance/import  (multipart form-data with a "file" field)
export async function POST(request: Request) {
  const { church, user } = await requireChurch();
  if (!(await can("attendance.manage")))
    return json({ ok: false, error: "You don't have permission to import attendance." }, 403);

  // "CSV import / export" is sold from Growth, exactly as the member import
  // holds it. Recording attendance by hand is on every plan, so nothing a
  // Starter church can already do is taken away.
  const gate = await refuseWithoutFeature("dataExport");
  if (gate) return json(gate, 403);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }
  if (!file) return json({ ok: false, error: "No file was uploaded." }, 400);

  const rows = parseCsv(await file.text());
  if (rows.length < 2) {
    return json({ ok: false, error: "The file has no data rows." }, 400);
  }

  const colMap: (AttendanceFieldKey | null)[] = rows[0].map(
    headerToAttendanceField,
  );
  if (!colMap.includes("date")) {
    return json(
      {
        ok: false,
        error:
          "Couldn't find a 'Date' column. Download the template for the expected columns.",
      },
      400,
    );
  }

  // Resolve service names → ids (case-insensitive) for this church.
  const services = await db
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(eq(service.churchId, church.id));
  const serviceByName = new Map(
    services.map((s) => [s.name.trim().toLowerCase(), s.id]),
  );

  const dataRows = rows.slice(1);
  const truncated = dataRows.length > MAX_ROWS;
  const limited = truncated ? dataRows.slice(0, MAX_ROWS) : dataRows;

  type Row = {
    serviceId: string | null;
    title: string | null;
    date: string;
    male: number;
    female: number;
    teenMale: number;
    teenFemale: number;
    /** Null when the file has no such column — see resolveImportedBands. */
    bands: Record<AttendanceBandField, number | null>;
    childMale: number;
    childFemale: number;
    children: number;
    firstTimerMale: number;
    firstTimerFemale: number;
    firstTimers: number;
    newConvertMale: number;
    newConvertFemale: number;
    newConverts: number;
    /** Adults + teens + children from the file. */
    base: number;
    /** The Total column, which stands only when the file has no split. */
    fileTotal: number;
    notes: string | null;
  };

  const parsed: Row[] = [];
  const errors: string[] = [];
  let skipped = 0;

  limited.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const get = (key: AttendanceFieldKey): string => {
      const col = colMap.indexOf(key);
      // Undo the formula guard the export puts on a title or a note, so a
      // file we wrote comes back exactly as it went out.
      return col >= 0 ? unescapeCsvCell(cells[col] ?? "") : "";
    };

    const date = normalizeDate(get("date"));
    if (!date) {
      skipped++;
      if (errors.length < 25)
        errors.push(`Row ${rowNo}: missing or invalid date`);
      return;
    }

    const name = get("name").trim();
    const serviceId = name
      ? (serviceByName.get(name.toLowerCase()) ?? null)
      : null;

    const male = normalizeCount(get("male"));
    const female = normalizeCount(get("female"));
    const teenMale = normalizeCount(get("teenMale"));
    const teenFemale = normalizeCount(get("teenFemale"));
    const childMale = normalizeCount(get("childMale"));
    const childFemale = normalizeCount(get("childFemale"));
    // A gender split wins over the total column; the total only stands on
    // its own for files without a split (e.g. exported before it existed).
    const children =
      childMale + childFemale > 0
        ? childMale + childFemale
        : normalizeCount(get("children"));
    const firstTimerMale = normalizeCount(get("firstTimerMale"));
    const firstTimerFemale = normalizeCount(get("firstTimerFemale"));
    const firstTimers =
      firstTimerMale + firstTimerFemale > 0
        ? firstTimerMale + firstTimerFemale
        : normalizeCount(get("firstTimers"));
    const newConvertMale = normalizeCount(get("newConvertMale"));
    const newConvertFemale = normalizeCount(get("newConvertFemale"));
    const newConverts =
      newConvertMale + newConvertFemale > 0
        ? newConvertMale + newConvertFemale
        : normalizeCount(get("newConverts"));
    const bands = Object.fromEntries(
      ATTENDANCE_BAND_FIELDS.map((k) => [
        k,
        colMap.includes(k) ? normalizeCount(get(k)) : null,
      ]),
    ) as Record<AttendanceBandField, number | null>;

    parsed.push({
      serviceId,
      title: serviceId ? null : name || "Event",
      date,
      male,
      female,
      teenMale,
      teenFemale,
      bands,
      childMale,
      childFemale,
      children,
      firstTimerMale,
      firstTimerFemale,
      firstTimers,
      newConvertMale,
      newConvertFemale,
      newConverts,
      base: male + female + teenMale + teenFemale + children,
      fileTotal: normalizeCount(get("total")),
      notes: get("notes").trim().slice(0, 1000) || null,
    });
  });

  let imported = 0;
  let oneOffsUpdated = 0;
  try {
    await db.transaction(async (tx) => {
      /*
       * One import per church at a time, so two uploads of the same file
       * cannot both read "no such event yet" below and both add it. Released
       * when the transaction ends.
       */
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`attendance-import:${church.id}`}))`,
      );

      /*
       * What is already recorded across the file's dates, read once.
       *
       * Two things need it. A service row upserts on (service, date) as it
       * always has, but a file without youth and senior columns must keep the
       * figures already stored there (see resolveImportedBands). And a one-off
       * event has no key to upsert on, so every row without a service used to
       * be inserted — re-importing an export doubled every one-off, every
       * meeting-recorded session and every session whose service had gone.
       */
      const dates = parsed.map((r) => r.date).sort();
      const onFile = dates.length
        ? await tx
            .select({
              id: attendanceSession.id,
              serviceId: attendanceSession.serviceId,
              title: attendanceSession.title,
              date: attendanceSession.date,
              youthMale: attendanceSession.youthMaleCount,
              youthFemale: attendanceSession.youthFemaleCount,
              seniorMale: attendanceSession.seniorMaleCount,
              seniorFemale: attendanceSession.seniorFemaleCount,
            })
            .from(attendanceSession)
            .where(
              and(
                eq(attendanceSession.churchId, church.id),
                gte(attendanceSession.date, dates[0]),
                lte(attendanceSession.date, dates[dates.length - 1]),
              ),
            )
            .orderBy(asc(attendanceSession.createdAt))
        : [];
      type OnFile = (typeof onFile)[number];
      const ownServices = new Set(services.map((s) => s.id));
      const byService = new Map<string, OnFile>();
      // A list per key, consumed as rows match: two events of the same name
      // on one day are two sessions, and each row claims one of them.
      const oneOffs = new Map<string, OnFile[]>();
      for (const s of onFile) {
        if (s.serviceId && ownServices.has(s.serviceId)) {
          byService.set(`${s.serviceId}|${s.date}`, s);
        } else {
          const k = oneOffSessionKey(s.date, s.title);
          oneOffs.set(k, [...(oneOffs.get(k) ?? []), s]);
        }
      }

      for (const r of parsed) {
        const match = r.serviceId
          ? byService.get(`${r.serviceId}|${r.date}`)
          : oneOffs.get(oneOffSessionKey(r.date, r.title))?.shift();
        const { bands, total } = resolveImportedBands({
          base: r.base,
          fileTotal: r.fileTotal,
          bands: r.bands,
          stored: match
            ? {
                youthMale: match.youthMale,
                youthFemale: match.youthFemale,
                seniorMale: match.seniorMale,
                seniorFemale: match.seniorFemale,
              }
            : null,
        });

        const values = {
          churchId: church.id,
          serviceId: r.serviceId,
          title: r.title,
          date: r.date,
          maleCount: r.male,
          femaleCount: r.female,
          teenMaleCount: r.teenMale,
          teenFemaleCount: r.teenFemale,
          youthMaleCount: bands.youthMale,
          youthFemaleCount: bands.youthFemale,
          seniorMaleCount: bands.seniorMale,
          seniorFemaleCount: bands.seniorFemale,
          childMaleCount: r.childMale,
          childFemaleCount: r.childFemale,
          childrenCount: r.children,
          firstTimerMaleCount: r.firstTimerMale,
          firstTimerFemaleCount: r.firstTimerFemale,
          firstTimerCount: r.firstTimers,
          newConvertMaleCount: r.newConvertMale,
          newConvertFemaleCount: r.newConvertFemale,
          newConvertCount: r.newConverts,
          totalCount: total,
          notes: r.notes,
          recordedBy: user.id,
          updatedAt: new Date(),
        };
        if (r.serviceId) {
          // One session per (church, service, date) — update if it exists.
          await tx
            .insert(attendanceSession)
            .values(values)
            .onConflictDoUpdate({
              target: [
                attendanceSession.churchId,
                attendanceSession.serviceId,
                attendanceSession.date,
              ],
              set: values,
            });
        } else if (match) {
          // The same event on the same day: corrected, not added twice.
          await tx
            .update(attendanceSession)
            .set(values)
            .where(
              and(
                eq(attendanceSession.id, match.id),
                eq(attendanceSession.churchId, church.id),
              ),
            );
          oneOffsUpdated++;
        } else {
          await tx.insert(attendanceSession).values(values);
        }
        imported++;
      }
    });
  } catch (e) {
    console.error("attendance import failed", e);
    return json(
      {
        ok: false,
        error: "Import failed while saving — no attendance was added.",
      },
      500,
    );
  }

  if (imported > 0) {
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
  }
  if (oneOffsUpdated > 0) {
    errors.push(
      `${oneOffsUpdated} one-off event${oneOffsUpdated === 1 ? " was" : "s were"} already recorded under the same name on the same day, so ${oneOffsUpdated === 1 ? "it was" : "they were"} updated rather than added again.`,
    );
  }
  if (truncated) errors.push(`Only the first ${MAX_ROWS} rows were imported.`);

  return json({ ok: true, imported, skipped, errors });
}
