"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownUp,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  Loader2,
  Mail,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { emailAttendanceReport } from "@/app/(app)/attendance/export-actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ImportResult = { imported: number; skipped: number; errors: string[] };

export function AttendanceExportMenu({
  userEmail,
  hasData = true,
  canManage = true,
}: {
  userEmail: string;
  hasData?: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState(userEmail);
  const [sending, startSend] = useTransition();

  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function sendEmail() {
    startSend(async () => {
      const res = await emailAttendanceReport(recipient);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Report sent to ${res.to}.`);
      setEmailOpen(false);
    });
  }

  function openImport() {
    setFile(null);
    setResult(null);
    setImportOpen(true);
  }

  async function runImport() {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/attendance/import", {
        method: "POST",
        body: fd,
      });
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
        `Imported ${data.imported} record${data.imported === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  // A view-only user with no data has nothing to export or import.
  if (!hasData && !canManage) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg" aria-label="Import or export">
            <ArrowDownUp className="size-5" />
            <span className="hidden sm:inline">Import / Export</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {hasData && (
            <>
              {/* Fast path: instant one-click PDF, no print dialog. */}
              <DropdownMenuItem asChild>
                <a href="/attendance/export/pdf" download>
                  <FileText className="size-4" />
                  Download PDF
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setRecipient(userEmail);
                  setEmailOpen(true);
                }}
              >
                <Mail className="size-4" />
                Email report…
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/attendance/export" download>
                  <FileSpreadsheet className="size-4" />
                  Export CSV
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {canManage && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  openImport();
                }}
              >
                <FileUp className="size-4" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/attendance/export?template=1" download>
                  <Download className="size-4" />
                  Download template
                </a>
              </DropdownMenuItem>
            </>
          )}
          {hasData && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/reports/attendance" target="_blank">
                  <Printer className="size-4" />
                  Print report
                </Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={emailOpen} onOpenChange={(o) => !sending && setEmailOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email attendance report</DialogTitle>
            <DialogDescription>
              We&apos;ll send the PDF report as an attachment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="report-recipient">Send to</Label>
            <Input
              id="report-recipient"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="name@church.org"
              autoComplete="email"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendEmail();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmailOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button onClick={sendEmail} disabled={sending || !recipient.trim()}>
              {sending && <Loader2 className="animate-spin" />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(o) => !importing && setImportOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import attendance from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV with at least a “Date” column.{" "}
              <a
                href="/attendance/export?template=1"
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
                Rows whose name matches a service update that day&apos;s figure;
                other names are added as one-off events.
              </p>
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={() => setImportOpen(false)}>Done</Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setImportOpen(false)}
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
