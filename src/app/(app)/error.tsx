"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertOctagon, ArrowLeft, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the whole church-facing app.
 *
 * Without one, a failure in any single page took out the entire route and
 * showed Next's unstyled default. The nav and sidebar in the layout above stay
 * put, so a church can carry on to another section instead of being stuck.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app]", error);
  }, [error]);

  return (
    <div className="bg-card mx-auto max-w-lg rounded-2xl border p-8 text-center">
      <div className="bg-destructive/10 text-destructive mx-auto grid size-12 place-items-center rounded-full">
        <AlertOctagon className="size-6" />
      </div>
      <h2 className="mt-4 text-xl font-extrabold">This page didn&apos;t load</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Nothing has been lost — whatever you had saved is still there. Try
        again, and if it keeps happening, let us know what you were doing.
      </p>
      {error.digest && (
        <p className="text-muted-foreground mt-2 font-mono text-xs">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCw className="size-4" />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
