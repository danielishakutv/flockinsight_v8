import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/**
 * Fallbacks sized to match the content they stand in for, so nothing jumps
 * when a Suspense boundary resolves.
 */

export function StatusLineSkeleton() {
  return <Skeleton className="h-12 w-full rounded-2xl" />;
}

export function QueueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function StatGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="gap-0 p-5">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="size-9 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-9 w-28" />
          <Skeleton className="mt-2 h-3 w-20" />
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-4 h-[260px] w-full rounded-xl" />
    </Card>
  );
}

export function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FloatPanelSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="mt-4 h-12 w-48" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-5 h-[200px] w-full rounded-xl" />
    </Card>
  );
}
