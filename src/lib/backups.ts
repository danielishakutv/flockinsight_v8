import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/*
 * Where the nightly dumps live. Absolute, and outside the app directory on
 * purpose, so a release swap never touches them.
 *
 * The file tracer cannot see through an env var, so a path built from
 * BACKUP_DIR looks to it like this module could touch anything: it gives up
 * and traces the whole project, which drags every source file (and public/)
 * into the server output. Nothing here can be made static — the directory is
 * deliberately outside the app so a release swap cannot disturb the dumps —
 * so each call below carries `turbopackIgnore`, which is what the build's own
 * warning asks for. The comments are load-bearing: remove one and the build
 * starts warning again and the output grows. They affect tracing only, never
 * what runs.
 */
export const BACKUP_DIR =
  process.env.BACKUP_DIR || "/var/backups/flockinsight";

// Only ever touch files matching the backup naming scheme.
const NAME_RE = /^flockinsight_\d{8}_\d{6}\.dump\.enc$/;

export type BackupFile = { name: string; size: number; mtime: number };

/**
 * Either the backups we can see, or the reason we cannot see any.
 *
 * The distinction is the whole point. "The directory holds no dumps" and "the
 * directory cannot be read" both used to come back as an empty array, so the
 * stale-backup alert fired identically whether backups had genuinely stopped
 * or the monitoring itself had broken — and an operator could not tell which
 * from the page. An empty `files` now means exactly one thing.
 */
export type BackupListing =
  | { ok: true; files: BackupFile[] }
  | { ok: false; error: string };

export async function listBackups(): Promise<BackupListing> {
  let names: string[];
  try {
    names = await fs.readdir(/*turbopackIgnore: true*/ BACKUP_DIR);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // The directory not existing yet is a real answer, not a failure: nothing
    // has ever been written there. That is the case on a dev box, and on a
    // server it genuinely means there are no backups — which should alert.
    if (code === "ENOENT") return { ok: true, files: [] };
    // Anything else (permission, I/O, a mount that went away) means we are
    // blind, which must never be reported as "none".
    console.error(`listBackups: cannot read ${BACKUP_DIR}`, e);
    return {
      ok: false,
      error: `Could not read ${BACKUP_DIR} (${code ?? "unknown error"}).`,
    };
  }

  const out: BackupFile[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) continue;
    try {
      const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, name);
      const st = await fs.stat(/*turbopackIgnore: true*/ full);
      out.push({ name, size: st.size, mtime: st.mtimeMs });
    } catch (e) {
      // One unreadable dump must not hide the others, but it is still said
      // out loud rather than quietly dropped from the count.
      console.error(`listBackups: cannot stat ${name} in ${BACKUP_DIR}`, e);
    }
  }
  return { ok: true, files: out.sort((a, b) => b.mtime - a.mtime) };
}

/** Validate a requested name and return its absolute path, or null. */
export function resolveBackupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null; // also blocks path traversal (no slashes)
  const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, name);
  if (
    path.dirname(path.resolve(/*turbopackIgnore: true*/ full)) !==
    path.resolve(/*turbopackIgnore: true*/ BACKUP_DIR)
  )
    return null;
  return full;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
