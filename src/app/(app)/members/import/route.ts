import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { firstTimerRun, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { can } from "@/lib/permissions";
import { memberLimitStatus } from "@/lib/plan-limits";
import { parseCsv } from "@/lib/csv";
import { headerToField } from "@/lib/members-data";
import { churchDial } from "@/lib/member-signup";
import { nationalNumber } from "@/lib/phone-intl";
import {
  addPhoneOwner,
  guardianKey,
  MAX_IMPORT_ERRORS,
  personKey,
  planMemberImport,
  type PhoneOwners,
} from "@/lib/member-import";

const MAX_ROWS = 5000;
const CHUNK = 500;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// POST /members/import  (multipart form-data with a "file" field)
export async function POST(request: Request) {
  const { church, user } = await requireChurch();
  if (!(await can("members.manage")))
    return json({ ok: false, error: "You don't have permission to import members." }, 403);

  // "CSV import / export" is sold from Growth. Typing members in one at a time
  // is on every plan, so nothing a Starter church can already do is taken away.
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

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return json(
      { ok: false, error: "The file has no data rows." },
      400,
    );
  }

  if (!rows[0].map(headerToField).includes("firstName")) {
    return json(
      {
        ok: false,
        error:
          "Couldn't find a 'First name' column. Download the template for the expected columns.",
      },
      400,
    );
  }

  const truncated = rows.length - 1 > MAX_ROWS;
  const dial = await churchDial(church.id);

  /*
   * Who is already on the register, in one read: every email, and the national
   * part of every phone with the first names of whoever has it. A re-imported
   * file (or a retry after a lost response) cannot double the register, and a
   * family sharing one phone is not mistaken for one person (see
   * planMemberImport).
   */
  const onFile = await db
    .select({
      id: member.id,
      email: member.email,
      phone: member.phone,
      firstName: member.firstName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth,
      guardianId: member.guardianId,
    })
    .from(member)
    .where(eq(member.churchId, church.id));
  const existingEmails = new Set<string>();
  const existingPhones: PhoneOwners = new Map();
  // And who everybody is, for the rows that carry no contact (see personKey).
  const nameById = new Map(
    onFile.map((r) => [r.id, [r.firstName, r.lastName].filter(Boolean).join(" ")]),
  );
  const existingPeople = new Set<string>();
  for (const r of onFile) {
    if (r.email) existingEmails.add(r.email.trim().toLowerCase());
    const n = r.phone ? nationalNumber(r.phone, dial) : null;
    if (n) addPhoneOwner(existingPhones, n, r.firstName);
    const byDob = personKey(r.firstName, r.lastName, r.dateOfBirth, null);
    if (byDob) existingPeople.add(byDob);
    const guardian = r.guardianId ? nameById.get(r.guardianId) : undefined;
    const byGuardian = guardian ? personKey(r.firstName, r.lastName, null, guardian) : null;
    if (byGuardian) existingPeople.add(byGuardian);
  }

  const plan = planMemberImport(rows, {
    dial,
    existingEmails,
    existingPhones,
    existingPeople,
    maxRows: MAX_ROWS,
  });
  const errors = plan.errors;
  const note = (msg: string) => {
    if (errors.length < MAX_IMPORT_ERRORS) errors.push(msg);
  };

  // Respect the plan member limit — import only up to the remaining headroom.
  // Counted AFTER de-duplication, so people already on file use none of it.
  let planned = plan.rows;
  const limit = await memberLimitStatus(church.id);
  if (limit.limit !== null) {
    const remaining = Math.max(0, limit.limit - limit.used);
    if (planned.length > remaining) {
      errors.push(
        `Plan limit reached — only ${remaining} of ${planned.length} new members were added. Upgrade your plan to add more.`,
      );
      planned = planned.slice(0, remaining);
    }
  }

  /*
   * Ids are chosen here rather than read back from RETURNING, so a child row
   * can be tied to its guardian without relying on the order Postgres hands
   * rows back in.
   */
  const inserts = planned.map((p) => ({
    id: randomUUID(),
    churchId: church.id,
    createdBy: user.id,
    ...p.values,
  }));
  const children = planned
    .map((p, i) => ({ p, id: inserts[i].id }))
    .filter((x) => x.p.values.isMinor && x.p.guardianName);

  let imported = 0;
  let linked = 0;
  let visitorsHeld = 0;
  try {
    // One transaction so an import is all-or-nothing.
    await db.transaction(async (tx) => {
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const batch = inserts.slice(i, i + CHUNK);
        if (batch.length) {
          await tx.insert(member).values(batch);
          imported += batch.length;
        }
      }

      /*
       * Imported visitors are history, not this week's first-timers.
       *
       * The first-timer sequence picks up every visitor created in the last
       * few weeks, and every imported row was created today — so a church
       * moving 600 visitor cards across from another system would have sent
       * all 600 a "thank you for visiting" text, charged to its wallet, and a
       * "become a member" invite a fortnight later. A row on the "all" channel
       * is how the sequence records a stage as already done (see
       * runFirstTimers), so each imported visitor gets one per stage and is
       * never messaged. They stay visitors, and stay in Follow-up.
       */
      const visitors = inserts.filter(
        (r) => r.status === "visitor" || r.status === "new_convert",
      );
      for (let i = 0; i < visitors.length; i += CHUNK) {
        const batch = visitors.slice(i, i + CHUNK);
        await tx
          .insert(firstTimerRun)
          .values(
            batch.flatMap((v) =>
              (["welcome", "invite"] as const).map((stage) => ({
                churchId: church.id,
                memberId: v.id,
                stage,
                channel: "all",
                // "skipped", not "sent": nothing was sent, and a count of
                // first-timer messages must not include every imported visitor.
                // The sweep only asks whether an "all" row exists.
                outcome: "skipped",
                detail: "Imported from a spreadsheet, so the automatic messages were not sent.",
              })),
            ),
          )
          .onConflictDoNothing();
      }
      visitorsHeld = visitors.length;

      /*
       * Guardians, by name, within this church only — the Guardian column
       * holds a name, and the export writes "First Last". Linked only when
       * exactly one member answers to it: a guess between two people of the
       * same name would attach a child to a stranger.
       */
      if (children.length > 0) {
        const everyone = await tx
          .select({
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
          })
          .from(member)
          .where(eq(member.churchId, church.id));
        const byName = new Map<string, string[]>();
        for (const m of everyone) {
          const k = guardianKey([m.firstName, m.lastName].filter(Boolean).join(" "));
          byName.set(k, [...(byName.get(k) ?? []), m.id]);
        }
        const toLink = new Map<string, string[]>();
        for (const c of children) {
          const ids = (byName.get(guardianKey(c.p.guardianName!)) ?? []).filter(
            (id) => id !== c.id,
          );
          if (ids.length === 1) {
            toLink.set(ids[0], [...(toLink.get(ids[0]) ?? []), c.id]);
          } else {
            note(
              `Row ${c.p.rowNo}: guardian "${c.p.guardianName}" ${
                ids.length === 0 ? "was not found" : "matches more than one member"
              } — ${c.p.values.firstName} was added without a guardian link`,
            );
          }
        }
        for (const [guardianId, childIds] of toLink) {
          const done = await tx
            .update(member)
            .set({ guardianId })
            .where(and(eq(member.churchId, church.id), inArray(member.id, childIds)))
            .returning({ id: member.id });
          linked += done.length;
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
  if (visitorsHeld > 0) {
    errors.push(
      `${visitorsHeld} visitor${visitorsHeld === 1 ? " was" : "s were"} imported without the automatic first-timer messages. Register new first-timers on the First-timers page.`,
    );
  }
  if (truncated) {
    errors.push(`Only the first ${MAX_ROWS} rows were imported.`);
  }

  return json({
    ok: true,
    imported,
    skipped: plan.skipped,
    duplicates: plan.duplicates,
    linked,
    errors,
  });
}
