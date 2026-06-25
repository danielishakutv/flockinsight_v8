"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Live local date + time. Renders nothing until mounted (avoids hydration drift). */
export function DateTime({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <div className="h-5" aria-hidden />;

  const date = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Clock className="text-muted-foreground size-4 shrink-0" />
      <span className="text-sm font-semibold">
        {date}
        <span className="text-muted-foreground font-normal"> · {time}</span>
      </span>
    </div>
  );
}
