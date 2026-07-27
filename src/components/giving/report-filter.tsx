"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const ALL = "__all__";

/** Project + "include settled" filters for the outstanding-pledges report. */
export function ReportFilter({
  projects,
  projectId,
  includeSettled,
}: {
  projects: { id: string; name: string }[];
  projectId: string;
  includeSettled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(next: { project?: string; all?: boolean }) {
    const p = new URLSearchParams();
    const proj = next.project ?? projectId;
    const all = next.all ?? includeSettled;
    if (proj) p.set("project", proj);
    if (all) p.set("all", "1");
    const qs = p.toString();
    start(() => router.push(`/giving/projects/report${qs ? `?${qs}` : ""}`));
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Select
          value={projectId || ALL}
          onValueChange={(v) => go({ project: v === ALL ? "" : v })}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2">
        {pending && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
        <Switch checked={includeSettled} onCheckedChange={(v) => go({ all: v })} />
        <Label className="text-sm">Include settled & cancelled</Label>
      </label>
    </div>
  );
}
