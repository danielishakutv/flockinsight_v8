import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/brand";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Wordmark logoClassName="size-8" className="text-lg" />
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
          >
            <ArrowLeft className="size-4" /> Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 lg:py-14">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Last updated: {updated}</p>
        <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:text-muted-foreground">
          {children}
        </div>
        <p className="text-muted-foreground mt-10 border-t pt-6 text-sm">
          Questions? Contact{" "}
          <a
            href="mailto:support@flockinsight.com"
            className="text-primary font-medium hover:underline"
          >
            support@flockinsight.com
          </a>
          .
        </p>
      </main>
    </div>
  );
}
