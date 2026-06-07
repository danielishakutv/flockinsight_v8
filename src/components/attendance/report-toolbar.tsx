"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Floating controls for the print report. Hidden in the printed output via
 * `print:hidden` so only the document itself ends up in the PDF.
 */
export function ReportToolbar() {
  return (
    <div className="no-print sticky top-0 z-10 mb-6 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur print:hidden">
      <Button asChild variant="ghost" size="sm">
        <Link href="/attendance">
          <ArrowLeft className="size-4" />
          Back to attendance
        </Link>
      </Button>
      <Button
        size="sm"
        onClick={() => window.print()}
        className="bg-violet-600 text-white hover:bg-violet-700"
      >
        <Printer className="size-4" />
        Print / Save as PDF
      </Button>
    </div>
  );
}
