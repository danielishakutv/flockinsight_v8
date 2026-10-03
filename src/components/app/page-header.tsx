import { cn } from "@/lib/utils";

export function PageContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  badge,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Sits beside the title — a "Beta" pill, or anything else that small. */
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex flex-wrap items-center gap-2.5 text-3xl font-extrabold tracking-tight lg:text-4xl">
          {title}
          {badge}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-1 text-base">{description}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
