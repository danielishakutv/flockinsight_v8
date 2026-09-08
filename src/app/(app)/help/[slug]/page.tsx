import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock,
  Info,
  Lightbulb,
  MessageCircle,
  Users,
} from "lucide-react";
import {
  GUIDES,
  getGuide,
  relatedGuides,
  sectionBlocks,
  type GuideBlock,
} from "@/lib/help-guides";
import { HELP_ICONS } from "@/components/help/icons";
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

/** One content block. Each kind reads differently, so each renders differently. */
function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "text":
      return (
        <p className="text-[15px] leading-relaxed">{block.text}</p>
      );

    case "bullets":
      return (
        <ul className="space-y-2">
          {block.items.map((line, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed">
              <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol className="space-y-4">
          {block.items.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="bg-primary text-primary-foreground mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug font-semibold">
                  {step.title}
                </p>
                {step.detail && (
                  <p className="text-muted-foreground mt-1 text-[14px] leading-relaxed">
                    {step.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      );

    case "example":
      return (
        <div className="bg-muted/50 rounded-xl border p-4">
          <p className="text-muted-foreground mb-2 text-[11px] font-bold tracking-wide uppercase">
            Example — {block.title}
          </p>
          <ul className="space-y-1.5">
            {block.lines.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed">
                <span className="bg-muted-foreground/40 mt-2 size-1 shrink-0 rounded-full" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "note":
      return (
        <div className="flex gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-500" />
          <p className="text-[14px] leading-relaxed">{block.text}</p>
        </div>
      );

    case "warning":
      return (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="text-[14px] leading-relaxed">{block.text}</p>
        </div>
      );

    case "table":
      return (
        // Wide tables scroll inside their own box rather than pushing the
        // whole page sideways on a phone.
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[21rem] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b">
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="text-muted-foreground py-2 pr-4 text-[11px] font-bold tracking-wide uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={
                        j === 0
                          ? "py-2.5 pr-4 align-top font-semibold"
                          : "text-muted-foreground py-2.5 pr-4 align-top"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = getGuide(slug);
  if (!g) notFound();
  const Icon = HELP_ICONS[g.icon] ?? HELP_ICONS.default;
  const related = relatedGuides(g);
  // Only worth a contents list when there is enough to scroll past.
  const showContents = g.sections.filter((s) => s.title).length >= 4;

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
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
            {g.title}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm">
            <Clock className="size-3.5" /> {g.minutes} min read
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-4 text-lg">{g.summary}</p>

      {g.whoFor && g.whoFor.length > 0 && (
        <div className="mt-5 rounded-xl border p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase">
            <Users className="size-3.5" /> Who this is for
          </p>
          <ul className="space-y-1">
            {g.whoFor.map((w, i) => (
              <li
                key={i}
                className="text-muted-foreground flex gap-2.5 text-[14px]"
              >
                <span className="bg-muted-foreground/40 mt-2 size-1 shrink-0 rounded-full" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showContents && (
        <nav className="mt-5">
          <p className="text-muted-foreground mb-2 text-[11px] font-bold tracking-wide uppercase">
            In this guide
          </p>
          <ol className="space-y-1">
            {g.sections.map((s, i) =>
              s.title ? (
                <li key={i}>
                  <a
                    href={`#s${i}`}
                    className="text-primary text-[14px] font-medium hover:underline"
                  >
                    {i + 1}. {s.title}
                  </a>
                </li>
              ) : null,
            )}
          </ol>
        </nav>
      )}

      <div className="mt-8 space-y-8">
        {g.sections.map((s, i) => (
          <section key={i} id={`s${i}`} className="scroll-mt-20">
            {s.title && (
              <h2 className="mb-3 text-lg font-bold tracking-tight">
                {s.title}
              </h2>
            )}
            <div className="space-y-4">
              {sectionBlocks(s).map((b, j) => (
                <Block key={j} block={b} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {g.faq && g.faq.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold tracking-tight">
            Common questions
          </h2>
          <div className="divide-y rounded-xl border">
            {g.faq.map((f, i) => (
              <details key={i} className="group p-4">
                <summary className="cursor-pointer list-none text-[15px] font-semibold">
                  {f.q}
                </summary>
                <p className="text-muted-foreground mt-2 text-[14px] leading-relaxed">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      )}

      {g.tip && (
        <div className="mt-8 flex gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <Lightbulb className="mt-0.5 size-5 shrink-0 text-emerald-500" />
          <p className="text-sm">
            <span className="font-bold">Tip: </span>
            {g.tip}
          </p>
        </div>
      )}

      {g.links.length > 0 && (
        <div className="mt-8">
          <p className="text-muted-foreground mb-2 text-xs font-bold tracking-wide uppercase">
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

      {related.length > 0 && (
        <div className="mt-8">
          <p className="text-muted-foreground mb-2 text-xs font-bold tracking-wide uppercase">
            Read next
          </p>
          <div className="space-y-2">
            {related.map((r) => {
              const RIcon = HELP_ICONS[r.icon] ?? HELP_ICONS.default;
              return (
                <Link
                  key={r.slug}
                  href={`/help/${r.slug}`}
                  className="hover:bg-accent/60 flex items-center gap-3 rounded-xl border p-3"
                >
                  <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                    <RIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {r.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {r.summary}
                    </span>
                  </span>
                  <ArrowRight className="text-muted-foreground/60 size-4 shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
