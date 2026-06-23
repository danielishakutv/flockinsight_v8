"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ImportResult = { imported: number; skipped: number; errors: string[] };

export function MembersDataMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function openImport() {
    setFile(null);
    setResult(null);
    setOpen(true);
  }

  async function runImport() {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/members/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Import failed.");
        return;
      }
      setResult({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
      });
      toast.success(
        `Imported ${data.imported} member${data.imported === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg">
            <ArrowDownUp className="size-5" />
            Import / Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <a href="/members/export" download>
              <FileSpreadsheet className="size-4" />
              Export CSV
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              openImport();
            }}
          >
            <FileUp className="size-4" />
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/members/export?template=1" download>
              <Download className="size-4" />
              Download template
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={(o) => !importing && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import members from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV with at least a “First name” column.{" "}
              <a
                href="/members/export?template=1"
                download
                className="text-primary font-medium hover:underline"
              >
                Download the template
              </a>{" "}
              to see every column.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="space-y-3 text-sm">
              <p className="font-semibold">
                Imported {result.imported}
                {result.skipped ? `, skipped ${result.skipped}` : ""}.
              </p>
              {result.errors.length > 0 && (
                <div className="bg-muted/40 max-h-40 overflow-y-auto rounded-lg border p-3 text-xs">
                  <ul className="list-disc space-y-1 pl-4">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="border-input file:bg-muted file:text-foreground block w-full cursor-pointer rounded-lg border text-sm file:mr-3 file:cursor-pointer file:border-0 file:px-3 file:py-2.5 file:font-medium"
              />
              <p className="text-muted-foreground text-xs">
                Existing members aren&apos;t changed — importing adds new rows.
              </p>
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={() => setOpen(false)}>Done</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={importing}
                >
                  Cancel
                </Button>
                <Button onClick={runImport} disabled={importing || !file}>
                  {importing && <Loader2 className="animate-spin" />}
                  Import
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
