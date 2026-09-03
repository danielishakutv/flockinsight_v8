import "dotenv/config";
import { Pool } from "pg";
import {
  nextPledgeStatus,
  outstandingOn,
  type PledgeStatus,
} from "../src/lib/pledge-status";

/**
 * One-off repair: settle pledge statuses that were left wrong by the old
 * one-way rule.
 *
 * Until the fix in "Stop pledges getting stuck on completed", a pledge was
 * only ever marked complete, never the other way. Delete or edit down the
 * payment that finished one and it stayed complete for good — dropping out of
 * the outstanding report and off the reminder run while the money was still
 * owed. The mirror case exists too: editing a payment up to the full amount
 * never closed the pledge, because nothing re-checked.
 *
 * The fix settles the status whenever a payment is recorded, edited or
 * deleted. It does not reach backwards, so a pledge already in the wrong state
 * stays there until somebody happens to touch one of its payments. This walks
 * the existing ones.
 *
 * It reuses nextPledgeStatus, the same rule the app applies live, so this can
 * never drift from what the application would decide on its own.
 *
 * SAFETY
 *   - Dry run unless you pass --apply. Nothing is written by default.
 *   - Only ever moves between "active" and "completed". A cancelled pledge is
 *     never touched in either direction: someone cancelled it on purpose.
 *   - Only the status column is written. Amounts, dates, members, payments and
 *     every other field are left exactly as they are.
 *   - Nothing is deleted, here or as a side effect.
 *   - Safe to run more than once; a second run reports 0.
 *
 * Usage:
 *   pnpm exec tsx scripts/reconcile-pledge-status.ts            # dry run
 *   pnpm exec tsx scripts/reconcile-pledge-status.ts --apply    # write
 */

const APPLY = process.argv.includes("--apply");

type Row = {
  id: string;
  church_id: string;
  church_name: string;
  status: PledgeStatus;
  amount: string;
  paid: string;
  giver: string | null;
  project_name: string | null;
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function money(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  // One pass over every pledge with what has actually been paid against it.
  // The sum is scoped by church as well as by pledge, matching the app.
  const { rows } = await pool.query<Row>(`
    select
      p.id,
      p.church_id,
      c.name as church_name,
      p.status,
      p.amount,
      coalesce((
        select sum(g.amount)
          from giving g
         where g.pledge_id = p.id
           and g.church_id = p.church_id
      ), 0) as paid,
      coalesce(
        nullif(trim(concat_ws(' ', m.first_name, m.last_name)), ''),
        p.giver_name
      ) as giver,
      pr.name as project_name
    from pledge p
    join church c on c.id = p.church_id
    left join member m on m.id = p.member_id
    left join project pr on pr.id = p.project_id
    order by c.name, p.created_at
  `);

  const changes = rows
    .map((r) => {
      const amount = Number(r.amount);
      const paid = Number(r.paid);
      const next = nextPledgeStatus(r.status, amount, paid);
      return next ? { row: r, amount, paid, next } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const cancelled = rows.filter((r) => r.status === "cancelled").length;

  console.log(`Pledges examined : ${rows.length}`);
  console.log(`Cancelled (never touched) : ${cancelled}`);
  console.log(`Out of step      : ${changes.length}`);

  if (changes.length === 0) {
    console.log("\nEvery pledge already matches what has been paid. Nothing to do.");
    return;
  }

  const reopened = changes.filter((c) => c.next === "active");
  const closed = changes.filter((c) => c.next === "completed");

  console.log(
    `\n  ${reopened.length} marked complete but still owing  → back to active`,
  );
  console.log(
    `  ${closed.length} fully paid but still open          → completed\n`,
  );

  let currentChurch = "";
  for (const c of changes) {
    if (c.row.church_name !== currentChurch) {
      currentChurch = c.row.church_name;
      console.log(`\n${currentChurch}`);
    }
    const owed = outstandingOn(c.amount, c.paid);
    console.log(
      `  ${c.row.status.padEnd(9)} → ${c.next.padEnd(9)}  ` +
        `${(c.row.giver ?? "Unnamed").slice(0, 24).padEnd(24)} ` +
        `${c.row.project_name ?? "—"}\n` +
        `${" ".repeat(4)}pledged ${money(c.amount)} · paid ${money(c.paid)} · ` +
        `${owed > 0 ? `outstanding ${money(owed)}` : "settled"}`,
    );
  }

  if (!APPLY) {
    console.log(
      `\n\nDRY RUN — nothing was written.` +
        `\nRe-run with --apply to make these ${changes.length} change(s).`,
    );
    return;
  }

  // Each pledge is updated by its own id and church, and only its status
  // column, so a concurrent edit to anything else cannot be clobbered.
  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query("begin");
    for (const c of changes) {
      const res = await client.query(
        `update pledge
            set status = $1, updated_at = now()
          where id = $2
            and church_id = $3
            and status = $4`,
        [c.next, c.row.id, c.row.church_id, c.row.status],
      );
      updated += res.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }

  console.log(`\n\nApplied: ${updated} pledge(s) updated.`);
  if (updated !== changes.length) {
    console.log(
      `${changes.length - updated} were skipped because their status changed ` +
        `while this ran. Re-run to pick them up.`,
    );
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
