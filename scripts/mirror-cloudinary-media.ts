/**
 * Check every Cloudinary-backed file is still there, and keep a copy on disk.
 *
 * WHY THIS DOES NOT MIGRATE ANYTHING, which is the important part.
 *
 * The churches already using FlockInsight have their photos, logos, devotional
 * images and sermons at Cloudinary. Those rows work. Rewriting 59 working
 * records to point somewhere else is a lot of risk — a half-finished run, a
 * mistyped path, an interrupted copy — in exchange for nothing a church would
 * notice. The safest thing that can be done to a working file is to leave it
 * alone.
 *
 * What IS worth doing is removing the single point of failure. Cloudinary is
 * now the only place those files exist; if an account lapsed or an asset were
 * deleted, the library would be full of broken links and there would be no
 * second copy. So this takes one, into MEDIA_ROOT, where the nightly media
 * backup already picks it up.
 *
 * Nothing in the app reads the mirror. The rows still point at Cloudinary and
 * still serve from Cloudinary. This is a safety net, not a switch.
 *
 *   pnpm tsx scripts/mirror-cloudinary-media.ts --check        # verify only
 *   pnpm tsx scripts/mirror-cloudinary-media.ts --mirror       # verify + copy
 *
 * Read-only against the database. It writes nothing but files, and never
 * deletes.
 */
import "dotenv/config";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, media } from "@/db/schema";

const MEDIA_ROOT =
  process.env.MEDIA_ROOT || "/home/flockinsight/app/shared/media";

/** Deliberately underscored: not a church id, so it can never collide with one. */
const MIRROR_DIR = path.join(MEDIA_ROOT, "_cloudinary-mirror");

const args = process.argv.slice(2);
const doMirror = args.includes("--mirror");
const checkOnly = args.includes("--check") || !doMirror;

async function main() {
  const rows = await db
    .select({
      id: media.id,
      churchId: media.churchId,
      churchName: church.name,
      url: media.url,
      bytes: media.bytes,
      format: media.format,
      kind: media.kind,
      title: media.title,
      originalName: media.originalName,
    })
    .from(media)
    .innerJoin(church, eq(church.id, media.churchId))
    .where(eq(media.provider, "cloudinary"));

  console.log(
    `${rows.length} Cloudinary-backed files across ${new Set(rows.map((r) => r.churchId)).size} churches`,
  );
  console.log(doMirror ? "mode: verify and copy\n" : "mode: verify only\n");

  if (doMirror) await mkdir(MIRROR_DIR, { recursive: true });

  let ok = 0;
  let missing = 0;
  let mirrored = 0;
  let alreadyHad = 0;
  const broken: string[] = [];

  for (const r of rows) {
    const label = `${r.churchName.slice(0, 28).padEnd(30)} ${r.kind.padEnd(11)} ${(r.title ?? r.originalName ?? r.id).slice(0, 28)}`;

    if (!r.url) {
      missing++;
      broken.push(`${r.id}  ${label}  (no url recorded)`);
      console.log(`  MISSING  ${label}  — no url on the row`);
      continue;
    }

    const ext = (r.format || r.url.split(".").pop() || "bin").replace(
      /[^a-z0-9]/gi,
      "",
    );
    const dest = path.join(MIRROR_DIR, `${r.id}.${ext}`);

    if (doMirror) {
      try {
        const existing = await stat(dest);
        if (existing.size > 0) {
          alreadyHad++;
          ok++;
          continue;
        }
      } catch {
        /* not mirrored yet */
      }
    }

    try {
      /*
       * A real GET rather than a HEAD. Cloudinary answers HEAD for things it
       * will not actually deliver, and "it is still there" is only worth
       * knowing if the bytes come back.
       */
      const res = await fetch(r.url, { redirect: "follow" });
      if (!res.ok) {
        missing++;
        broken.push(`${r.id}  ${label}  (HTTP ${res.status})`);
        console.log(`  MISSING  ${label}  — HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) {
        missing++;
        broken.push(`${r.id}  ${label}  (empty)`);
        console.log(`  EMPTY    ${label}`);
        continue;
      }

      ok++;
      if (doMirror) {
        await writeFile(dest, buf);
        mirrored++;
      }
    } catch (e) {
      missing++;
      broken.push(`${r.id}  ${label}  (${(e as Error).message})`);
      console.log(`  ERROR    ${label}  — ${(e as Error).message}`);
    }
  }

  console.log("\n--- result ---");
  console.log(`  still at Cloudinary and readable : ${ok}`);
  console.log(`  NOT retrievable                  : ${missing}`);
  if (doMirror) {
    console.log(`  copied to disk this run          : ${mirrored}`);
    console.log(`  already had a copy               : ${alreadyHad}`);
    console.log(`  mirror directory                 : ${MIRROR_DIR}`);
  } else {
    console.log("\n  (run again with --mirror to keep a copy on disk)");
  }

  if (broken.length) {
    console.log("\n--- files that could NOT be read ---");
    for (const b of broken) console.log(`  ${b}`);
    console.log(
      "\nThese rows point at assets Cloudinary did not return. Nothing was changed;\n" +
        "they need a decision — re-upload, or remove the row.",
    );
  }

  console.log(
    checkOnly && !doMirror
      ? "\nNothing was changed. Cloudinary rows still serve from Cloudinary."
      : "\nNothing was changed in the database. Cloudinary rows still serve from Cloudinary.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n  Failed:", e);
    process.exit(1);
  });
