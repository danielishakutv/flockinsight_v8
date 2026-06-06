import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

export const BACKUP_DIR =
  process.env.BACKUP_DIR || "/var/backups/flockinsight";

// Only ever touch files matching the backup naming scheme.
const NAME_RE = /^flockinsight_\d{8}_\d{6}\.dump\.enc$/;

export type BackupFile = { name: string; size: number; mtime: number };

export async function listBackups(): Promise<BackupFile[]> {
  try {
    const names = await fs.readdir(BACKUP_DIR);
    const out: BackupFile[] = [];
    for (const name of names) {
      if (!NAME_RE.test(name)) continue;
      const st = await fs.stat(path.join(BACKUP_DIR, name));
      out.push({ name, size: st.size, mtime: st.mtimeMs });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** Validate a requested name and return its absolute path, or null. */
export function resolveBackupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null; // also blocks path traversal (no slashes)
  const full = path.join(BACKUP_DIR, name);
  if (path.dirname(path.resolve(full)) !== path.resolve(BACKUP_DIR)) return null;
  return full;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
