import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, Lightbulb, MessageCircle } from "lucide-react";
import { getGuide, GUIDES } from "@/lib/help-guides";
import { helpIcon } from "@/components/help/icons";
import { Button } from "@/components/ui/button";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const g = getGuide(slug);
  return g
    ? { title: `${g.title} · Help`, description: g.summary }
    : { title: "Guide not found" };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();
  const Icon = helpIcon(g.icon);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/help">
          <ArrowLeft className="size-4" /> Help & Support
        </Link>
      </Button>

      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-xl">
          <Icon className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
            {g.title}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
            <Clock className="size-3.5" /> {g.minutes} min read
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-4 text-lg">{g.summary}</p>

      <div className="mt-6 space-y-6">
        {g.sections.map((s, i) => (
          <section key={i}>
            {s.title && (
              <h2 className="mb-2 text-lg font-bold">{s.title}</h2>
            )}
            <ul className="space-y-2">
              {s.body.map((line, j) => (
                <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed">
                  <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {g.tip && (
        <div className="mt-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <Lightbulb className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <p className="text-sm">
            <span className="font-bold">Tip: </span>
            {g.tip}
          </p>
        </div>
      )}

      {g.links.length > 0 && (
        <div className="mt-6">
          <p className="text-muted-foreground mb-2 text-xs font-bold uppercase tracking-wide">
            Go there now
          </p>
          <div className="flex flex-wrap gap-2">
            {g.links.map((l) => (
              <Button key={l.href} asChild variant="outline" size="sm">
                <Link href={l.href}>
                  {l.label} <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Still need help */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
        <div>
          <p className="font-bold">Still need help?</p>
          <p className="text-muted-foreground text-sm">
            Our team is happy to help you out.
          </p>
        </div>
        <Button asChild>
          <Link href="/help/support">
            <MessageCircle className="size-4" /> Contact us
          </Link>
        </Button>
      </div>
    </div>
  );
}
