import Link from "next/link";
import { COMPARISON_TERMS } from "@/lib/seo/keywords";
import { comparePath } from "@/lib/seo/pages";
import type { SectionCopy } from "@/lib/landing-sections";
import { MarketingTable, Td, Tr } from "./marketing-table";

/**
 * "How we compare, including where we lose."
 *
 * This is the most commercially frightening block on the page and the one most
 * likely to earn it. Three things are going on.
 *
 * **It is the highest-intent content we can publish.** "X alternative" is among
 * the highest-intent phrases on the internet — somebody typing it has already
 * decided to leave — and a page that answers it honestly is the page they
 * finish reading.
 *
 * **It is the format assistants quote.** Comparison tables are what an AI
 * answer is assembled from when a person asks "what should my church use". A
 * page that only states its own strengths reads as a brochure and gets
 * discounted; a page that names the trade-off gets cited, because the trade-off
 * is the part the asker cannot get anywhere else.
 *
 * **It is true.** Planning Center's service planning is better than ours.
 * Breeze is simpler, and simpler is a real feature. ChurchSuite has a decade of
 * UK integrations. Saying so costs nothing we could have won anyway, and it
 * buys the credibility that makes the rest of the page believable.
 *
 * `honestWeakness` is a required field on `ComparisonTerm` and
 * `keywords.test.ts` asserts it is a real sentence of real length, so this
 * column cannot quietly become empty the next time somebody is tempted.
 */
export function CompareTable({ copy }: { copy: SectionCopy }) {
  return (
    <>
      <MarketingTable
        caption={copy.compareIntro}
        columns={[
          copy.compareCols.what,
          copy.compareCols.edge,
          copy.compareCols.weakness,
        ]}
      >
        {COMPARISON_TERMS.map((c) => (
          <Tr key={c.primary}>
            <Td label={copy.compareCols.what} strong>
              <Link
                href={comparePath(c)}
                className="hover:text-primary underline decoration-dotted underline-offset-4"
              >
                {c.competitor}
              </Link>
            </Td>
            <Td label={copy.compareCols.edge}>{c.ourEdge}</Td>
            <Td label={copy.compareCols.weakness} muted>
              {c.honestWeakness}
            </Td>
          </Tr>
        ))}
      </MarketingTable>
      <p className="text-muted-foreground mt-4 text-center text-xs">
        {copy.compareFootnote}
      </p>
    </>
  );
}
