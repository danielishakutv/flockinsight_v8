import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePlatform } from "@/lib/platform-access";
import { getSurveyResults } from "@/lib/surveys";
import { displayValue } from "@/lib/forms-shared";
import { siteUrl } from "@/lib/site";
import { readability, readabilityNote, shareLabel } from "@/lib/thin-data";
import { Panel, SampleChip } from "@/components/superadmin/panel";
import { SurveyEditor } from "@/components/superadmin/survey-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollableTable } from "@/components/ui/scrollable-table";

export const dynamic = "force-dynamic";

export default async function SurveyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatform("platform.messaging.send");
  const { id } = await params;

  const results = await getSurveyResults(id);
  if (!results) notFound();

  const { survey, responses, scales, audienceSize, sample } = results;
  const verdict = readability(sample, "churches");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/superadmin/surveys"
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-semibold"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          All surveys
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{survey.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm wrap-anywhere">
          {siteUrl()}/s/{survey.slug}
        </p>
      </div>

      <SurveyEditor
        survey={{
          id: survey.id,
          title: survey.title,
          description: survey.description,
          status: survey.status,
          anonymous: survey.anonymous,
          audience: survey.audience,
          targetPlan: survey.targetPlan,
          targetCountry: survey.targetCountry,
          churchIds: survey.churchIds,
          fields: survey.fields,
        }}
        audienceSize={audienceSize}
      />

      {scales.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Scores</CardTitle>
            <div className="mt-1.5">
              <SampleChip sample={sample} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {verdict !== "solid" && (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {readabilityNote(verdict, "churches")} A single answer moves the
                score a long way at this size.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {scales.map((s) => (
                <div key={s.fieldId} className="rounded-xl border p-3">
                  <div className="text-muted-foreground text-xs leading-snug">
                    {s.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="text-2xl font-bold tabular-nums">
                      {s.average}
                      <span className="text-muted-foreground text-sm font-medium">
                        {" "}
                        / 10
                      </span>
                    </span>
                    {s.nps !== null && (
                      <span className="text-muted-foreground text-xs">
                        NPS {s.nps > 0 ? "+" : ""}
                        {s.nps}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Panel
        title="Answers"
        sample={sample}
        kind="churches"
        action={
          <span className="text-muted-foreground shrink-0 text-xs font-semibold">
            {shareLabel(responses.length, audienceSize)} replied
          </span>
        }
      >
        {responses.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Nobody has answered yet. Send it, or share the link.
          </p>
        ) : (
          <ScrollableTable label="Survey answers">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 font-medium">
                    {survey.anonymous ? "Answered" : "Church"}
                  </th>
                  {survey.fields.map((f) => (
                    <th key={f.id} className="py-2 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 whitespace-nowrap">
                      {survey.anonymous
                        ? r.createdAt.toLocaleDateString()
                        : (r.churchName ?? "Via link")}
                    </td>
                    {survey.fields.map((f) => (
                      <td key={f.id} className="py-2 wrap-anywhere">
                        {displayValue(r.data[f.id] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </Panel>
    </div>
  );
}
