import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { parseCsv } from "@/lib/csv";
import {
  headerToField,
  normalizeDate,
  normalizeGender,
  normalizeStatus,
  type MemberFieldKey,
} from "@/lib/members-data";

const MAX_ROWS = 5000;
const CHUNK = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clip(v: string | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /members/import  (multipart form-data with a "file" field)
export async function POST(request: Request) {
  const { church, user } = await requireChurch();

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return json({ ok: false, error: "Could not read the upload." }, 400);
  }
  if (!file) return json({ ok: false, error: "No file was uploaded." }, 400);

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return json(
      { ok: false, error: "The file has no data rows." },
      400,
    );
  }

  // Map each column index to a member field via the header row.
  const headers = rows[0];
  const colMap: (MemberFieldKey | null)[] = headers.map(headerToField);
  if (!colMap.includes("firstName")) {
    return json(
      {
        ok: false,
        error:
          "Couldn't find a 'First name' column. Download the template for the expected columns.",
      },
      400,
    );
  }

  const dataRows = rows.slice(1);
  const truncated = dataRows.length > MAX_ROWS;
  const limited = truncated ? dataRows.slice(0, MAX_ROWS) : dataRows;

  type NewMember = typeof member.$inferInsert;
  const inserts: NewMember[] = [];
  const errors: string[] = [];
  let skipped = 0;

  limited.forEach((cells, idx) => {
    const rowNo = idx + 2; // +1 header, +1 to 1-base
    const get = (key: MemberFieldKey): string => {
      const col = colMap.indexOf(key);
      return col >= 0 ? (cells[col] ?? "") : "";
    };

    const firstName = get("firstName").trim();
    if (!firstName) {
      skipped++;
      if (errors.length < 25) errors.push(`Row ${rowNo}: missing first name`);
      return;
    }

    const emailRaw = get("email").trim();
    const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null;

    inserts.push({
      churchId: church.id,
      createdBy: user.id,
      firstName: firstName.slice(0, 80),
      middleName: clip(get("middleName"), 80),
      lastName: clip(get("lastName"), 80),
      gender: normalizeGender(get("gender")),
      status: normalizeStatus(get("status")),
      phone: clip(get("phone"), 40),
      email,
      dateOfBirth: normalizeDate(get("dateOfBirth")),
      joinedAt: normalizeDate(get("joinedAt")),
      house: clip(get("house"), 120),
      street: clip(get("street"), 160),
      city: clip(get("city"), 120),
      lga: clip(get("lga"), 120),
      state: clip(get("state"), 120),
      country: clip(get("country"), 120),
      notes: clip(get("notes"), 1000),
    });
  });

  let imported = 0;
  try {
    // One transaction so an import is all-or-nothing (safe to retry).
    await db.transaction(async (tx) => {
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const batch = inserts.slice(i, i + CHUNK);
        if (batch.length) {
          await tx.insert(member).values(batch);
          imported += batch.length;
        }
      }
    });
  } catch (e) {
    console.error("member import failed", e);
    return json(
      { ok: false, error: "Import failed while saving — no members were added." },
      500,
    );
  }

  if (imported > 0) {
    revalidatePath("/members");
    revalidatePath("/dashboard");
  }
  if (truncated) {
    errors.push(`Only the first ${MAX_ROWS} rows were imported.`);
  }

  return json({ ok: true, imported, skipped, errors });
}
