"use client";

import { useEffect } from "react";
import { AlertOctagon, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Segment error boundary. A monitoring tool that shows a blank page when one
 * query fails is worse than one that admits the failure.
 */
export default function SuperadminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[superadmin]", error);
  }, [error]);

  return (
    <div className="bg-card mx-auto max-w-lg rounded-2xl border p-8 text-center">
      <div className="bg-destructive/10 text-destructive mx-auto grid size-12 place-items-center rounded-full">
        <AlertOctagon className="size-6" />
      </div>
      <h2 className="mt-4 text-xl font-extrabold">This section failed to load</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        The rest of the admin panel still works. If this keeps happening, check
        the server logs.
      </p>
      {error.digest && (
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          Reference: {error.digest}
        </p>
      )}
      <Button onClick={reset} className="mt-5">
        <RotateCw className="size-4" />
        Try again
      </Button>
    </div>
  );
}
