import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceSession, service } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { parseCsv } from "@/lib/csv";
import { normalizeDate } from "@/lib/members-data";
import {
  headerToAttendanceField,
  normalizeCount,
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
    children: number;
    firstTimers: number;
    newConverts: number;
    total: number;
    notes: string | null;
  };

  const parsed: Row[] = [];
  const errors: string[] = [];
  let skipped = 0;

  limited.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const get = (key: AttendanceFieldKey): string => {
      const col = colMap.indexOf(key);
      return col >= 0 ? (cells[col] ?? "") : "";
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
    const children = normalizeCount(get("children"));
    const breakdown = male + female + children;
    // Prefer the breakdown; fall back to a provided Total when there's none.
    const total = breakdown > 0 ? breakdown : normalizeCount(get("total"));

    parsed.push({
      serviceId,
      title: serviceId ? null : name || "Event",
      date,
      male,
      female,
      children,
      firstTimers: normalizeCount(get("firstTimers")),
      newConverts: normalizeCount(get("newConverts")),
      total,
      notes: get("notes").trim().slice(0, 1000) || null,
    });
  });

  let imported = 0;
  try {
    await db.transaction(async (tx) => {
      for (const r of parsed) {
        const values = {
          churchId: church.id,
          serviceId: r.serviceId,
          title: r.title,
          date: r.date,
          maleCount: r.male,
          femaleCount: r.female,
          childrenCount: r.children,
          firstTimerCount: r.firstTimers,
          newConvertCount: r.newConverts,
          totalCount: r.total,
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
  if (truncated) errors.push(`Only the first ${MAX_ROWS} rows were imported.`);

  return json({ ok: true, imported, skipped, errors });
}
