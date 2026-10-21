import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member, project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { parseCsv, unescapeCsvCell } from "@/lib/csv";
import { backfillFund, fundAccountFor } from "@/lib/finance-giving-sync";
import { countGifts, giftKey, splitAlreadyRecorded } from "@/lib/giving-import";
import { normalizeDate } from "@/lib/members-data";
import { decimalSeparatorFor } from "@/lib/money-input";
import { localeForCountry } from "@/lib/country-profile";
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

  // "CSV import / export" is sold from Growth, exactly as the member import
  // holds it. Recording gifts by hand is on every plan, so nothing a Starter
  // church can already do is taken away.
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
    // Undo the export's formula guard, so a giver or note that went out as
    // "'=..." comes back as written and still matches the gift on file.
    return col >= 0 ? unescapeCsvCell(cells[col] ?? "") : "";
  };

  // Existing categories by lowercased name.
  const existingCats = await getGivingCategories(church.id);
  const catByName = new Map(
    existingCats.map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  let catCount = existingCats.length;

  // This church's projects, by lowercased name, so the Project column the
  // export writes comes back in. Only this church's own, so an id from
  // anywhere else can never be attached.
  const projects = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(eq(project.churchId, church.id));
  const projByName = new Map(
    projects.map((p) => [p.name.trim().toLowerCase(), p.id]),
  );

  // How this church writes a decimal, to settle "5.000" (five thousand in
  // Maputo, five in Lagos) where there is nobody to ask.
  const decimal = decimalSeparatorFor(
    localeForCountry(church.country),
    church.country,
  );

  const errors: string[] = [];
  let skipped = 0;
  let createdCategories = 0;

  // First pass: validate rows + discover any new category names to create.
  type Parsed = {
    rowNo: number;
    date: string;
    amount: number;
    categoryName: string;
    giver: string | null;
    method: ReturnType<typeof normalizeMethod>;
    note: string | null;
    projectId: string | null;
  };
  const parsed: Parsed[] = [];
  const newCatNames: string[] = [];

  limited.forEach((cells, idx) => {
    const rowNo = idx + 2;
    // normalizeDate refuses a day that does not exist (2026-02-30), so one
    // bad row is reported by number instead of failing the whole file.
    const date = normalizeDate(get(cells, "date"));
    const amount = normalizeAmount(get(cells, "amount"), decimal);
    if (!date || amount === null) {
      skipped++;
      if (errors.length < 25)
        errors.push(
          `Row ${rowNo}: ${!date ? "invalid date" : "invalid or ambiguous amount"}`,
        );
      return;
    }
    const projectName = get(cells, "project").trim();
    const projectId = projectName
      ? (projByName.get(projectName.toLowerCase()) ?? null)
      : null;
    if (projectName && !projectId && errors.length < 25) {
      errors.push(
        `Row ${rowNo}: project "${projectName.slice(0, 80)}" not found — imported without a project`,
      );
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
      rowNo,
      date,
      amount,
      categoryName,
      giver: get(cells, "giver").trim().slice(0, 160) || null,
      method: normalizeMethod(get(cells, "method")),
      note: get(cells, "note").trim().slice(0, 500) || null,
      projectId,
    });
  });

  let imported = 0;
  let duplicates = 0;
  try {
    await db.transaction(async (tx) => {
      /*
       * One giving import per church at a time. Without it, two uploads of
       * the same file — a double click, or a retry while the first is still
       * saving — would both read the ledger below before either had written,
       * and both add everything. Released when the transaction ends.
       */
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`giving-import:${church.id}`}))`,
      );

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

      const categoryIdOf = (p: Parsed) =>
        p.categoryName
          ? (catByName.get(p.categoryName.toLowerCase()) ?? null)
          : null;

      /*
       * What the ledger already holds across the file's dates, keyed the way
       * the export writes a gift, so the same file a second time — or a file
       * we exported, corrected and brought back — adds nothing already added.
       * Counted, not just looked up: see lib/giving-import.ts for why two
       * identical rows must both go in on a first import.
       */
      const dates = parsed.map((p) => p.date).sort();
      const onFile = dates.length
        ? await tx
            .select({
              date: giving.date,
              amount: giving.amount,
              giverName: giving.giverName,
              memberFirst: member.firstName,
              memberLast: member.lastName,
              categoryId: giving.categoryId,
              projectId: giving.projectId,
              method: giving.method,
              note: giving.note,
            })
            .from(giving)
            .leftJoin(
              member,
              and(eq(member.id, giving.memberId), eq(member.churchId, giving.churchId)),
            )
            .where(
              and(
                eq(giving.churchId, church.id),
                gte(giving.date, dates[0]),
                lte(giving.date, dates[dates.length - 1]),
              ),
            )
        : [];
      const { add, already } = splitAlreadyRecorded(
        parsed,
        (p) =>
          giftKey({
            date: p.date,
            amount: p.amount,
            giver: p.giver,
            categoryId: categoryIdOf(p),
            projectId: p.projectId,
            method: p.method,
            note: p.note,
          }),
        countGifts(
          onFile.map((g) => ({
            date: g.date,
            amount: g.amount,
            // The name the export prints for a member's gift.
            giver:
              [g.memberFirst, g.memberLast].filter(Boolean).join(" ") ||
              g.giverName,
            categoryId: g.categoryId,
            projectId: g.projectId,
            method: g.method,
            note: g.note,
          })),
        ),
      );
      duplicates = already.length;
      for (const p of already) {
        if (errors.length < 25)
          errors.push(`Row ${p.rowNo}: already recorded — not added again`);
      }

      type NewGiving = typeof giving.$inferInsert;
      const inserts: NewGiving[] = add.map((p) => ({
        churchId: church.id,
        categoryId: categoryIdOf(p),
        amount: p.amount,
        date: p.date,
        giverName: p.giver,
        method: p.method,
        note: p.note,
        projectId: p.projectId,
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
    if (parsed.some((p) => p.projectId)) revalidatePath("/giving/projects");
  }
  if (createdCategories > 0) {
    errors.push(
      `Created ${createdCategories} new categor${createdCategories === 1 ? "y" : "ies"} from the file.`,
    );
  }
  if (duplicates > 0) {
    errors.push(
      `${duplicates} gift${duplicates === 1 ? " matched one" : "s matched ones"} already recorded (same date, amount, giver, category, project, method and note), so ${duplicates === 1 ? "it was" : "they were"} not added again.`,
    );
  }
  if (truncated) errors.push(`Only the first ${MAX_ROWS} rows were imported.`);

  return json({
    ok: true,
    imported,
    skipped: skipped + duplicates,
    duplicates,
    errors,
  });
}
