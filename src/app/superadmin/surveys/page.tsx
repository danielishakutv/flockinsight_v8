import { count } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requirePlatform } from "@/lib/platform-access";
import { SURVEY_TEMPLATES, listSurveys } from "@/lib/surveys";
import { siteUrl } from "@/lib/site";
import { SurveysAdmin } from "@/components/superadmin/surveys-admin";

export const metadata = { title: "Surveys · Admin" };
export const dynamic = "force-dynamic";

/**
 * Asking the churches what they think.
 *
 * The same builder a church uses for its own forms, addressed one level up.
 * With five active churches the answers are not a statistic and the page never
 * pretends otherwise — but four pastors telling you the same thing is worth
 * more than any chart on the insights page.
 */
export default async function SurveysPage() {
  await requirePlatform("platform.messaging.send");

  const [surveys, [{ n }]] = await Promise.all([
    listSurveys(),
    db.select({ n: count() }).from(church),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Surveys</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask the churches what they think. Answers land here and on Insights.
        </p>
      </div>

      <SurveysAdmin
        surveys={surveys}
        templates={SURVEY_TEMPLATES}
        totalChurches={n}
        baseUrl={siteUrl()}
      />
    </div>
  );
}
