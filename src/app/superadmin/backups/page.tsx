import { format } from "date-fns";
import { Database, Download, ShieldCheck } from "lucide-react";
import { listBackups, formatBytes, BACKUP_DIR } from "@/lib/backups";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Backups · Admin" };

export default async function BackupsPage() {
  const backups = await listBackups();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Backups
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Encrypted database snapshots (all churches). Daily at 02:00.
        </p>
      </div>

      <div className="bg-primary/5 border-primary/20 flex items-start gap-3 rounded-xl border p-4">
        <ShieldCheck className="text-primary mt-0.5 size-5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">These files are AES-256 encrypted.</p>
          <p className="text-muted-foreground">
            To restore one, decrypt with your key file:&nbsp;
            <code className="bg-muted rounded px-1 py-0.5 text-xs">
              openssl enc -d -aes-256-cbc -pbkdf2 -in FILE -pass file:KEY | pg_restore -d DB
            </code>
            &nbsp;(see <code className="text-xs">deploy/BACKUPS.md</code>).
          </p>
        </div>
      </div>

      {backups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
              <Database className="size-7" />
            </div>
            <p className="text-muted-foreground">
              No backups found in <code className="text-xs">{BACKUP_DIR}</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => (
            <div
              key={b.name}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm sm:p-4"
            >
              <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                <Database className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{b.name}</p>
                <p className="text-muted-foreground text-xs">
                  {format(new Date(b.mtime), "MMM d, yyyy 'at' HH:mm")} ·{" "}
                  {formatBytes(b.size)}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/superadmin/backups?name=${encodeURIComponent(b.name)}`}
                  download
                >
                  <Download className="size-4" />
                  Download
                </a>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
