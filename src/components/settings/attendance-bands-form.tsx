"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveAttendanceBands } from "@/app/(app)/settings/attendance/actions";
import { useT } from "@/components/i18n-provider";

type Row = {
  key: string;
  label: string;
  enabled: boolean;
  hint: string;
  locked: boolean;
};

/**
 * Which groups a church counts, and its own words for them.
 *
 * The bands are fixed and only the names vary — see `attendance-bands.ts` for
 * why. What this page has to do well is warn honestly: turning a band on
 * changes what the bands above it MEAN from that day forward, and a church
 * comparing this year with last needs to know that before it clicks, not
 * afterwards.
 */
export function AttendanceBandsForm({ bands }: { bands: Row[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(bands);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /*
   * Was a band off when this page loaded and is on now? That is the moment
   * worth warning about — not a band that was already in use.
   */
  const newlyOn = rows.filter(
    (r) => r.enabled && !bands.find((b) => b.key === r.key)?.enabled,
  );

  const save = () =>
    start(async () => {
      const res = await saveAttendanceBands(
        rows.map((r) => ({ key: r.key, label: r.label, enabled: r.enabled })),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settings.savedYourNextAttendanceSheet"));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Card key={r.key}>
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Switch
                checked={r.enabled}
                disabled={r.locked}
                onCheckedChange={(v) => update(r.key, { enabled: v })}
                aria-label={`Count ${r.label}`}
                className="mt-1 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  maxLength={40}
                  aria-label={`What you call ${r.key}`}
                  className="font-semibold"
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {r.hint}
                  {r.locked && " Always counted — every attendance sheet you have ever recorded is in this group."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {newlyOn.length > 0 && (
        /*
          The thing a church will otherwise discover in three months, looking
          at a chart and wondering why the adult figure fell off a cliff.
        */
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <Info className="size-4 shrink-0" /> Worth knowing before you save
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-amber-800/90 dark:text-amber-300/90">
            Until now, {newlyOn.map((r) => r.label).join(" and ")} were counted
            among your {rows.find((r) => r.key === "adults")?.label ?? "Adults"}.
            From today they are counted separately, and past Sundays are left
            exactly as they were recorded — so your{" "}
            {rows.find((r) => r.key === "adults")?.label ?? "Adults"} figure will
            look lower from here than it did last month. Nothing has been lost;
            it has moved.
          </p>
        </div>
      )}

      <Button onClick={save} disabled={pending} size="lg" className="w-full sm:w-auto">
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
