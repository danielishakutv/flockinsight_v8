"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Download,
  FileSpreadsheet,
  FileText,
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

export function AttendanceExportMenu({ userEmail }: { userEmail: string }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState(userEmail);
  const [sending, startSend] = useTransition();

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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg">
            <Download className="size-5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
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
              Download CSV
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/reports/attendance" target="_blank">
              <Printer className="size-4" />
              Print report
            </Link>
          </DropdownMenuItem>
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
    </>
  );
}
