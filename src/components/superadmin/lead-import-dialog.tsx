"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importLeads } from "@/app/superadmin/growth/actions";
import { LEAD_CSV_TEMPLATE_HEADERS, LEAD_SOURCES } from "@/lib/growth-shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SAMPLE = [
  LEAD_CSV_TEMPLATE_HEADERS.join(","),
  "Grace Chapel,Pastor Daniel,Senior pastor,pastor@grace.org,08088256055,,Yola,Adamawa,Pentecostal,250,event,Met at the pastors' conference",
].join("\n");

export function LeadImportDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [source, setSource] = useState("import");

  function run(csv: string) {
    if (!csv.trim()) return toast.error("Paste a CSV or choose a file.");
    startTransition(async () => {
      const res = await importLeads(csv, source);
      if (!res.ok) return void toast.error(res.error);
      const bits = [
        `${res.added} added`,
        res.duplicates ? `${res.duplicates} already known` : "",
        res.skipped ? `${res.skipped} skipped` : "",
      ].filter(Boolean);
      toast.success(bits.join(" · "));
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  async function onFile(file: File) {
    const content = await file.text();
    setText(content);
    run(content);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="size-4" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a list of churches</DialogTitle>
          <DialogDescription>
            A CSV with a header row. Only the church name plus an email or phone
            is required — anything already in the pipeline is left alone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Mark these as coming from</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full" aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Choose a file</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
              className="file:bg-secondary file:text-secondary-foreground block w-full cursor-pointer rounded-lg border text-sm file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:px-4 file:py-2.5 file:font-semibold"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="csv">…or paste the rows</Label>
            <Textarea
              id="csv"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={SAMPLE}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-xs">
              Recognised columns: {LEAD_CSV_TEMPLATE_HEADERS.join(", ")}. Common
              spellings (Pastor, Mobile, Organisation, Members…) are matched too.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => run(text)} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
