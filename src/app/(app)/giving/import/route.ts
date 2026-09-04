import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { parseCsv } from "@/lib/csv";
import { backfillFund, fundAccountFor } from "@/lib/finance-giving-sync";
import { normalizeDate } from "@/lib/members-data";
import {
  getGivingCategories,
  headerToGivingField,
  normalizeAmount,
  normalizeMethod,
  type GivingFieldKey,
} from "@/lib/giving-data";

const MAX_ROWS = 5000;
const CHUNK = 500;
const MAX_NEW_CATEGORIES = 50;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /giving/import  (multipart form-data with a "file" field)
export async function POST(request: Request) {
  const { church, user } = await requireChurch();
  if (!(await can("giving.manage")))
    return json({ ok: false, error: "You don't have permission to import giving." }, 403);

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

  const colMap: (GivingFieldKey | null)[] = rows[0].map(headerToGivingField);
  if (!colMap.includes("date") || !colMap.includes("amount")) {
    return json(
      {
        ok: false,
        error:
          "Couldn't find 'Date' and 'Amount' columns. Download the template for the expected columns.",
      },
      400,
    );
  }

  const dataRows = rows.slice(1);
  const truncated = dataRows.length > MAX_ROWS;
  const limited = truncated ? dataRows.slice(0, MAX_ROWS) : dataRows;

  const get = (cells: string[], key: GivingFieldKey): string => {
    const col = colMap.indexOf(key);
    return col >= 0 ? (cells[col] ?? "") : "";
  };

  // Existing categories by lowercased name.
  const existingCats = await getGivingCategories(church.id);
  const catByName = new Map(
    existingCats.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  let catCount = existingCats.length;

  const errors: string[] = [];
  let skipped = 0;
  let createdCategories = 0;

  // First pass: validate rows + discover any new category names to create.
  type Parsed = {
    date: string;
    amount: number;
    categoryName: string;
    giver: string | null;
    method: ReturnType<typeof normalizeMethod>;
    note: string | null;
  };
  const parsed: Parsed[] = [];
  const newCatNames: string[] = [];

  limited.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const date = normalizeDate(get(cells, "date"));
    const amount = normalizeAmount(get(cells, "amount"));
    if (!date || amount === null) {
      skipped++;
      if (errors.length < 25)
        errors.push(
          `Row ${rowNo}: ${!date ? "invalid date" : "invalid amount"}`,
        );
      return;
    }
    const categoryName = get(cells, "category").trim();
    const key = categoryName.toLowerCase();
    if (
      categoryName &&
      !catByName.has(key) &&
      !newCatNames.some((n) => n.toLowerCase() === key) &&
      catCount + newCatNames.length < MAX_NEW_CATEGORIES + existingCats.length
    ) {
      newCatNames.push(categoryName.slice(0, 120));
    }
    parsed.push({
      date,
      amount,
      categoryName,
      giver: get(cells, "giver").trim().slice(0, 160) || null,
      method: normalizeMethod(get(cells, "method")),
      note: get(cells, "note").trim().slice(0, 500) || null,
    });
  });

  let imported = 0;
  try {
    await db.transaction(async (tx) => {
      // Create any new categories first, so rows can reference them.
      for (const name of newCatNames) {
        const [row] = await tx
          .insert(givingCategory)
          .values({ churchId: church.id, name, sortOrder: catCount })
          .returning({ id: givingCategory.id });
        catByName.set(name.toLowerCase(), row.id);
        catCount++;
        createdCategories++;
      }

      type NewGiving = typeof giving.$inferInsert;
      const inserts: NewGiving[] = parsed.map((p) => ({
        churchId: church.id,
        categoryId: p.categoryName
          ? (catByName.get(p.categoryName.toLowerCase()) ?? null)
          : null,
        amount: p.amount,
        date: p.date,
        giverName: p.giver,
        method: p.method,
        note: p.note,
        recordedBy: user.id,
      }));

      for (let i = 0; i < inserts.length; i += CHUNK) {
        const batch = inserts.slice(i, i + CHUNK);
        if (batch.length) {
          await tx.insert(giving).values(batch);
          imported += batch.length;
        }
      }
    });
  } catch (e) {
    console.error("giving import failed", e);
    return json(
      { ok: false, error: "Import failed while saving — nothing was added." },
      500,
    );
  }

  // Gifts imported here belong in their category's fund exactly as if they
  // had been typed in one at a time. Done after the transaction commits, and
  // per category rather than per row: backfillFund is one INSERT ... SELECT
  // that skips gifts already mirrored, so it costs one statement per category
  // and adds nothing on a re-run.
  //
  // Best-effort. The import itself has already succeeded, and a fund that
  // failed to catch up can be brought level from Settings without re-importing.
  if (imported > 0) {
    const touched = [
      ...new Set(
        parsed
          .map((p) =>
            p.categoryName ? catByName.get(p.categoryName.toLowerCase()) : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    for (const categoryId of touched) {
      try {
        const fund = await fundAccountFor(church.id, categoryId);
        if (!fund) continue;
        const [cat] = await db
          .select({ name: givingCategory.name })
          .from(givingCategory)
          .where(
            and(
              eq(givingCategory.id, categoryId),
              eq(givingCategory.churchId, church.id),
            ),
          )
          .limit(1);
        if (cat) {
          await backfillFund(church.id, categoryId, fund.id, cat.name);
        }
      } catch (e) {
        console.error("giving import: fund catch-up failed", { categoryId }, e);
      }
    }
  }

  if (imported > 0) {
    revalidatePath("/giving");
    revalidatePath("/settings/giving");
    revalidatePath("/dashboard");
    revalidatePath("/finance");
  }
  if (createdCategories > 0) {
    errors.push(
      `Created ${createdCategories} new categor${createdCategories === 1 ? "y" : "ies"} from the file.`,
    );
  }
  if (truncated) errors.push(`Only the first ${MAX_ROWS} rows were imported.`);

  return json({ ok: true, imported, skipped, errors });
}
