import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { FormField } from "@/lib/forms-shared";
import { getSurveyBySlug } from "@/lib/surveys";
import { SurveySubmit } from "@/components/surveys/survey-submit";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = await getSurveyBySlug(slug);
  if (!s || s.status === "draft") return { title: "Survey not found" };
  return {
    title: s.title,
    description: s.description ?? undefined,
    robots: { index: false },
  };
}

/**
 * Answering a survey, from a link.
 *
 * No sign-in required on purpose. The churches most worth hearing from are the
 * ones that stopped signing in, and a survey they cannot open without logging
 * in is a survey that only reaches the people already happy.
 */
export default async function PublicSurveyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const s = await getSurveyBySlug(slug);
  if (!s || s.status === "draft") notFound();

  const fields = (s.fields ?? []) as FormField[];

  return (
    <div className="bg-muted/40 min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 lg:py-12">
        <p className="mb-6 text-lg font-extrabold tracking-tight">
          Flock<span className="text-primary">Insight</span>
        </p>

        <div className="bg-card border-t-primary mb-4 rounded-2xl border border-t-4 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight">{s.title}</h1>
          {s.description && (
            <p className="text-muted-foreground mt-2 whitespace-pre-wrap">
              {s.description}
            </p>
          )}
        </div>

        {s.status === "closed" ? (
          <div className="bg-card rounded-2xl border p-8 text-center">
            <p className="text-lg font-semibold">
              This survey has closed.
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Thank you if you already answered — it was read.
            </p>
          </div>
        ) : fields.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-2xl border p-8 text-center">
            This survey does not have any questions yet.
          </div>
        ) : (
          <SurveySubmit slug={slug} fields={fields} anonymous={s.anonymous} />
        )}
      </div>
    </div>
  );
}
