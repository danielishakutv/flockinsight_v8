import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Branded 404. Deliberately does not guess whether the visitor is signed in:
 * it offers the way home and the way in, and lets them pick.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-6 py-16">
      <div className="mx-auto max-w-md text-center">
        <div className="bg-muted text-muted-foreground mx-auto grid size-12 place-items-center rounded-full">
          <Compass className="size-6" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          We can&apos;t find that page
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The link may be out of date, or the page may have moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/">Go to the homepage</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Open my church</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
