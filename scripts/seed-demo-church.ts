/**
 * Fill ONE church with believable demo data, for marketing screenshots and
 * videos — or clear it out again.
 *
 * The data itself lives in src/lib/demo-seed.ts, which the two-hourly demo
 * reset shares. This file is the safety rail around it:
 *
 *   - It does nothing without `--church <slug|handle|id>`. There is no
 *     default and no "first church" fallback.
 *   - It resolves exactly one church and refuses if the identifier matches
 *     none or more than one.
 *   - It prints what it matched and stops, unless you add `--confirm`.
 *   - It refuses a church that already has real data, unless you add
 *     `--force`, so it cannot be pointed at a live congregation by accident.
 *   - `--undo` removes exactly the rows the manifest lists, and nothing else.
 *
 * Usage:
 *   pnpm tsx scripts/seed-demo-church.ts --church toko-church            # dry run
 *   pnpm tsx scripts/seed-demo-church.ts --church toko-church --confirm  # write
 *   pnpm tsx scripts/seed-demo-church.ts --church toko-church --undo --confirm
 */
import "dotenv/config";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../src/db";
import { attendanceSession, church, giving, member } from "../src/db/schema";
import {
  readManifest,
  seedDemoData,
  undoDemoSeed,
} from "../src/lib/demo-seed";

function die(msg: string): never {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function opt(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : null;
}

const CHURCH = opt("church");
const CONFIRM = flag("confirm");
const FORCE = flag("force");
const UNDO = flag("undo");

/* ------------------------------------------------------------------ *
 * Resolve the target church
 * ------------------------------------------------------------------ */

async function resolveChurch() {
  if (!CHURCH) {
    die(
      "No church given.\n\n" +
        "    Usage: pnpm tsx scripts/seed-demo-church.ts --church <slug|handle|id> [--confirm]\n\n" +
        "    This script writes to a live database and will never guess which\n" +
        "    church you meant.",
    );
  }

  const rows = await db
    .select({
      id: church.id,
      name: church.name,
      slug: church.slug,
      handle: church.handle,
      currency: church.currency,
    })
    .from(church)
    .where(
      or(
        eq(church.id, CHURCH),
        eq(church.slug, CHURCH),
        eq(church.handle, CHURCH),
      ),
    );

  if (rows.length === 0) {
    const all = await db
      .select({ name: church.name, slug: church.slug, handle: church.handle })
      .from(church)
      .limit(30);
    console.error(`\n  ✖ No church matches "${CHURCH}".\n`);
    console.error("  Churches on this server:");
    for (const c of all) {
      console.error(
        `    - ${c.name}   slug=${c.slug}${c.handle ? `  handle=${c.handle}` : ""}`,
      );
    }
    console.error("");
    process.exit(1);
  }
  if (rows.length > 1) {
    die(`"${CHURCH}" matches ${rows.length} churches. Use the exact id.`);
  }
  return rows[0];
}

/** What this church already holds, so we never bury a real congregation. */
async function existingCounts(churchId: string) {
  const [m] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.churchId, churchId));
  const [g] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(giving)
    .where(eq(giving.churchId, churchId));
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendanceSession)
    .where(eq(attendanceSession.churchId, churchId));
  return { members: m?.n ?? 0, giving: g?.n ?? 0, attendance: a?.n ?? 0 };
}

/* ------------------------------------------------------------------ *
 * Undo
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const target = await resolveChurch();
  const counts = await existingCounts(target.id);

  console.log("\n  Target church");
  console.log(`    name     ${target.name}`);
  console.log(`    id       ${target.id}`);
  console.log(`    slug     ${target.slug}`);
  console.log(`    handle   ${target.handle ?? "—"}`);
  console.log(`    currency ${target.currency}`);
  console.log(
    `\n  It currently holds ${counts.members} members, ${counts.giving} giving records, ${counts.attendance} attendance records.`,
  );

  if (UNDO) {
    if (!CONFIRM) {
      const m = await readManifest(target.id);
      if (!m) {
        console.log(
          "\n  No demo-seed manifest for this church — nothing to undo.\n",
        );
        return;
      }
      const total = Object.values(m).reduce(
        (n, v) => n + (Array.isArray(v) ? v.length : 0),
        0,
      );
      const seededOn = m.seededAt.slice(0, 10);
      console.log(
        `\n  DRY RUN — would remove ${total} rows created by this script on ${seededOn}.\n` +
          "  Re-run with --confirm to do it.\n",
      );
      return;
    }
    console.log("\n  Removing the rows this script created…");
    const removed = await undoDemoSeed(target.id);
    if (!removed.ok) {
      die(
        "No demo-seed manifest found for this church.\n" +
          "    Either it was never seeded, or the manifest was removed.\n" +
          "    Nothing was deleted — this script will not guess which rows are demo data.",
      );
    }
    console.log("\n  Done.\n");
    return;
  }

  // A church with real records is almost certainly not the demo one.
  const looksLive = counts.members > 20 || counts.giving > 20;
  if (looksLive && !FORCE) {
    die(
      `"${target.name}" already holds ${counts.members} members and ${counts.giving} giving records.\n` +
        "    That looks like a real congregation, so nothing was written.\n\n" +
        "    If this really is the demo church, re-run with --force.",
    );
  }

  if (!CONFIRM) {
    console.log(
      "\n  DRY RUN — nothing written.\n" +
        "  Re-run with --confirm to seed this church.\n",
    );
    return;
  }

  console.log(`\n  Seeding "${target.name}"…\n`);
  await seedDemoData(target.id);
  console.log(
    "\n  Done. Every row created is listed in a manifest, and all of it can be\n" +
      "  removed — and nothing else — with:\n" +
      `    pnpm tsx scripts/seed-demo-church.ts --church ${CHURCH} --undo --confirm\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n  ✖ Failed:", e);
    process.exit(1);
  });
