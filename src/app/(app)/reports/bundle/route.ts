import { requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { allowedDatasets } from "@/lib/report-catalog";
import { buildDataset, buildDictionary } from "@/lib/report-data";
import { CSV_BOM, toCsv } from "@/lib/csv";
import { parseRange, rangeLabel, rangeSuffix } from "@/lib/report-range";
import { createZip, type ZipEntry } from "@/lib/zip";

/**
 * Everything, in one download: a ZIP of one CSV per dataset, plus a data
 * dictionary and a README.
 *
 * Only the datasets the person may see are included — someone without
 * `giving.view` gets a bundle with no giving in it, and the README says so
 * rather than leaving them to wonder whether the church has no giving.
 *
 *   GET /reports/bundle?from=2026-01-01&to=2026-03-31
 */
export async function GET(request: Request) {
  const { church } = await requireChurch();
  const access = await getAccess();
  const datasets = allowedDatasets([...access.perms], access.isOwner);

  if (datasets.length === 0)
    return new Response("You don't have permission to download any reports.", {
      status: 403,
    });

  const range = parseRange(new URL(request.url).searchParams);
  const stamp = new Date().toISOString().slice(0, 10);

  // Sequential on purpose: a couple of dozen queries fired at once would spike
  // the connection pool for what is already a background-ish download.
  const entries: ZipEntry[] = [];
  const counts: Record<string, number> = {};
  for (const d of datasets) {
    const data = await buildDataset(d.id, church.id, range);
    counts[d.id] = data.rows.length;
    entries.push({
      name: `${d.category}/${d.id}.csv`,
      data: CSV_BOM + toCsv([data.columns, ...data.rows]),
    });
  }

  const dictionary = buildDictionary(datasets);
  entries.push({
    name: "data-dictionary.csv",
    data: CSV_BOM + toCsv([dictionary.columns, ...dictionary.rows]),
  });

  const excluded = access.isOwner
    ? []
    : (await import("@/lib/report-catalog")).DATASETS.filter(
        (d) => !datasets.some((a) => a.id === d.id),
      );

  const readme = [
    `${church.name} — FlockInsight data export`,
    `Generated: ${new Date().toISOString()}`,
    `Period: ${rangeLabel(range)}`,
    "",
    "WHAT'S IN HERE",
    "Every dataset is a CSV in a folder named after its category. Files are",
    "UTF-8 with a byte-order mark, so Excel opens them correctly by double-click.",
    "",
    "HOW THE FILES FIT TOGETHER",
    "Each row starts with its own id, and carries the ids of whatever it relates",
    "to alongside the readable name — for example group-memberships.csv has both",
    "member_id and member_name. Join on the id, never on the name: two people",
    "share a name, and a category can be renamed.",
    "See data-dictionary.csv for every dataset, its grain, and its joins.",
    "",
    "FILES",
    ...datasets.map(
      (d) =>
        `  ${d.category}/${d.id}.csv — ${d.label} (${counts[d.id].toLocaleString()} rows). ${d.grain}.`,
    ),
    `  data-dictionary.csv — what each file holds and how it joins.`,
    "",
    ...(excluded.length
      ? [
          "NOT INCLUDED",
          "Your role doesn't grant access to these, so they were left out:",
          ...excluded.map((d) => `  ${d.label} (needs "${d.perm}")`),
          "",
        ]
      : []),
    "A NOTE ON PRIVACY",
    "This export contains personal data about real people — names, phone numbers,",
    "email addresses, home addresses and giving records. Store it somewhere",
    "access-controlled, and delete your copy when the analysis is finished.",
    "",
  ].join("\r\n");

  entries.push({ name: "README.txt", data: readme });

  const zip = await createZip(entries);
  const filename = `${church.slug}-full-export${rangeSuffix(range)}-${stamp}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
