import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { requireSuperAdmin } from "@/lib/session";
import { resolveBackupPath } from "@/lib/backups";

// Superadmin-only download of an encrypted DB backup.
export async function GET(req: NextRequest) {
  await requireSuperAdmin(); // redirects non-superadmins

  const name = req.nextUrl.searchParams.get("name") ?? "";
  const full = resolveBackupPath(name);
  if (!full) {
    return new NextResponse("Invalid backup name", { status: 400 });
  }

  try {
    const data = await readFile(full);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Backup not found", { status: 404 });
  }
}
