import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrainingBadge } from "@/components/training/training-badge";
import { rankBadge, rankInfo, type CertRank } from "@/lib/certification-shared";
import { cn } from "@/lib/utils";

export type RankLadderItem = {
  rank: CertRank;
  state: "earned" | "withdrawn" | "progress" | "locked";
  /** What it takes, in the reader's language. */
  requirement: string;
  /** "Earned 21 Oct 2026", or the withdrawal line. */
  dateLine: string | null;
  issuedOn: string | null;
  code: string | null;
};

/**
 * The three ranks, side by side from md up and stacked on a phone.
 * Presentational: every string arrives translated from the page.
 */
export function RankLadder({
  items,
  labels,
}: {
  items: RankLadderItem[];
  labels: { download: string; verify: string };
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.rank}
          className={cn(
            "bg-card flex flex-col gap-3 rounded-2xl border p-4",
            item.state === "earned" && "border-emerald-500/40",
            item.state === "locked" && "opacity-75",
          )}
        >
          <div className="flex items-center gap-2">
            <TrainingBadge badge={rankBadge(item.rank, item.issuedOn)} />
            {item.state === "locked" && <Lock className="text-muted-foreground size-3.5" aria-hidden />}
          </div>
          <p className="font-bold leading-tight">{rankInfo(item.rank).label}</p>
          <p className="text-muted-foreground text-sm">{item.requirement}</p>
          {item.dateLine && (
            <p
              className={cn(
                "text-sm font-medium",
                item.state === "withdrawn" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {item.dateLine}
            </p>
          )}
          {item.state === "earned" && item.code && (
            <div className="mt-auto flex flex-col gap-2">
              <Button asChild size="sm">
                {/* A route handler download, so a plain anchor rather than <Link>. */}
                <a href={`/help/course/certificate/${item.rank}`}>
                  <Download className="size-4" /> {labels.download}
                </a>
              </Button>
              <Link
                href={`/cert/${item.code}`}
                className="text-primary truncate text-xs font-medium hover:underline"
              >
                {labels.verify}: /cert/{item.code}
              </Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
