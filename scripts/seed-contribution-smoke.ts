/**
 * One group contribution, with the shapes the smoke scripts need to look at.
 *
 * `scripts/audit-mobile.mjs` scans `/p/zz-smoke-choir-levy` because a
 * collection's public link is the most-opened page in the product on a phone —
 * it arrives in a WhatsApp group and is tapped from that chat's own in-app
 * browser. The audit needs the page to exist and to be *full*: an empty
 * collection renders none of the layouts that overflow.
 *
 * So the fixture is deliberately awkward rather than tidy. It carries a
 * confirmed payment, one still awaiting confirmation, an anonymous giver, a
 * giver with a note, somebody who has given nothing, and a payout — because
 * those are the six states the page has to render, and the one it got wrong
 * first time (three money columns inside a 320px screen) only appears when all
 * the figures are there.
 *
 *   pnpm tsx scripts/seed-contribution-smoke.ts --church <slug|handle|id>
 *   pnpm tsx scripts/seed-contribution-smoke.ts --church demo --undo
 *
 * Safety, following scripts/seed-demo-church.ts:
 *   - It does nothing without `--church`. There is no "first church" fallback,
 *     because a test fixture appearing in a real congregation's screens is the
 *     one outcome that matters here.
 *   - It resolves exactly one church and refuses if the identifier matches none
 *     or more than one.
 *   - It only ever touches the one collection it owns, found by a fixed slug,
 *     so `--undo` cannot take anything else with it.
 */
import "dotenv/config";
import { eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  contributionApproval,
  contributionContributor,
  contributionEntry,
  contributionPayout,
} from "@/db/schema";

/** The one collection this script owns. Fixed, so --undo is exact. */
const SLUG = "zz-smoke-choir-levy";

async function main() {
  const args = process.argv.slice(2);
  const churchArg = args[args.indexOf("--church") + 1];
  const undo = args.includes("--undo");

  if (!args.includes("--church") || !churchArg || churchArg.startsWith("--")) {
    console.error(
      "Pass --church <slug|handle|id>. There is no default, on purpose.\n" +
        "  pnpm tsx scripts/seed-contribution-smoke.ts --church demo",
    );
    process.exit(1);
  }

  const matches = await db
    .select({
      id: church.id,
      name: church.name,
      handle: church.handle,
      currency: church.currency,
    })
    .from(church)
    .where(
      or(
        eq(church.id, churchArg),
        eq(church.handle, churchArg),
        sql`lower(${church.name}) = lower(${churchArg})`,
      ),
    );

  if (matches.length === 0) {
    console.error(`No church matches "${churchArg}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(
      `"${churchArg}" matches ${matches.length} churches. Use the id:\n` +
        matches.map((m) => `  ${m.id}  ${m.name}`).join("\n"),
    );
    process.exit(1);
  }

  const target = matches[0];
  console.log(`Church: ${target.name} (${target.id})`);

  /*
   * Removing the fixture removes its children with it — every child table
   * cascades from `contribution`. Scoped to this church AND this slug, so it can
   * only ever match the one row this script created.
   */
  const existing = await db
    .delete(contribution)
    .where(sql`${contribution.slug} = ${SLUG} and ${contribution.churchId} = ${target.id}`)
    .returning({ id: contribution.id });

  if (undo) {
    console.log(
      existing.length > 0
        ? `Removed the fixture collection and everything on it.`
        : `Nothing to remove.`,
    );
    process.exit(0);
  }
  if (existing.length > 0) console.log("Replaced the previous fixture.");

  const today = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);

  const [pot] = await db
    .insert(contribution)
    .values({
      churchId: target.id,
      title: "Choir uniform levy",
      purpose:
        "New uniforms for the choir before the anniversary service. 5,000 from each member.",
      slug: SLUG,
      kind: "equal",
      status: "open",
      perPersonAmount: 5000,
      payInstructions:
        "Grace Chapel Choir\n0123456789 — First Bank\nOr hand it to the choir treasurer on Sunday.",
      dueDate,
      visibility: "detailed",
      showPayouts: true,
      showNotes: true,
      allowSelfReport: true,
      confirmationsRequired: 1,
      payoutApprovalsRequired: 2,
    })
    .returning({ id: contribution.id });

  /** The six states the public page has to render. */
  const people: {
    name: string;
    amount: number;
    note: string | null;
    anonymous: boolean;
    confirmed: boolean;
  }[] = [
    {
      name: "Grace Udo",
      amount: 5000,
      note: "God bless the choir!",
      anonymous: false,
      confirmed: true,
    },
    { name: "Emeka Obi", amount: 5000, note: null, anonymous: false, confirmed: true },
    // Part-paid AND unconfirmed, so the page shows a claim that is not yet money.
    {
      name: "Mary Bello",
      amount: 2500,
      note: "Balance next week",
      anonymous: false,
      confirmed: false,
    },
    // Anonymous: the public page must say "Anonymous", the church's own screens
    // must still say her name. Both are asserted by the smoke checks.
    { name: "Folake Ajayi", amount: 5000, note: null, anonymous: true, confirmed: true },
    // On the list, has given nothing — so "3 of 5 have given" has something to say.
    { name: "Tunde Adeyemi", amount: 0, note: null, anonymous: false, confirmed: false },
  ];

  for (const p of people) {
    const [contributor] = await db
      .insert(contributionContributor)
      .values({
        contributionId: pot.id,
        churchId: target.id,
        name: p.name,
        isAnonymous: p.anonymous,
      })
      .returning({ id: contributionContributor.id });

    if (p.amount === 0) continue;

    const [entry] = await db
      .insert(contributionEntry)
      .values({
        contributionId: pot.id,
        churchId: target.id,
        contributorId: contributor.id,
        amount: p.amount,
        method: "transfer",
        paidOn: today,
        note: p.note,
        status: p.confirmed ? "confirmed" : "pending",
        confirmedAt: p.confirmed ? new Date() : null,
      })
      .returning({ id: contributionEntry.id });

    if (p.confirmed) {
      await db.insert(contributionApproval).values({
        churchId: target.id,
        entryId: entry.id,
        decision: "confirm",
        actorName: "Bisi A.",
      });
    }
  }

  await db.insert(contributionPayout).values({
    contributionId: pot.id,
    churchId: target.id,
    kind: "expense",
    amount: 4000,
    paidOn: today,
    payee: "Ankara Fabrics Ltd",
    purpose: "Fabric deposit",
    status: "approved",
    approvedAt: new Date(),
  });

  console.log(
    [
      `Seeded /p/${SLUG}`,
      `  15,000 ${target.currency} confirmed, 2,500 awaiting, 4,000 paid out, 11,000 held`,
      `  5 people on the list, 3 have given, 1 anonymous`,
      `  Remove it again with --undo`,
    ].join("\n"),
  );
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n  Failed:", e);
    process.exit(1);
  });
