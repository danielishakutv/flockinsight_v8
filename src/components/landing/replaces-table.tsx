import { ArrowRight } from "lucide-react";
import { REPLACES, type SectionCopy } from "@/lib/landing-sections";
import { MarketingTable, Td, Tr } from "./marketing-table";

/**
 * "One subscription, instead of eight."
 *
 * The anchoring table. A price read on its own is judged absolutely, which
 * makes any figure feel like a new cost on top of what a church already
 * spends. The same price read beside the eight things it removes is judged
 * relatively — and relative is how the comparison actually happens in
 * somebody's head whether we help them or not.
 *
 * It sits immediately above the pricing section for that reason. Order is the
 * whole mechanism: after pricing it is a justification, before pricing it is a
 * frame.
 *
 * The middle column names the real tool — Zoom, Google Forms, Linktree — rather
 * than "various tools", and a test enforces that. Specificity is what makes the
 * row recognisable as the reader's own situation; vagueness persuades nobody
 * and cannot be quoted by anything.
 */
export function ReplacesTable({ copy }: { copy: SectionCopy }) {
  return (
    <MarketingTable
      caption={copy.replacesIntro}
      columns={[
        copy.replacesCols.job,
        copy.replacesCols.insteadOf,
        copy.replacesCols.module,
      ]}
    >
      {REPLACES.map((r) => (
        <Tr key={r.job}>
          <Td label={copy.replacesCols.job} strong>
            {r.job}
          </Td>
          <Td label={copy.replacesCols.insteadOf} muted>
            {r.insteadOf}
          </Td>
          <Td label={copy.replacesCols.module}>
            <span className="text-primary inline-flex items-center gap-1.5 font-semibold">
              {/*
                An arrow as an icon, not as a character. `→` is a glyph Noto
                Sans does not carry, and this project has already paid for that
                once: every PDF the platform made drew an empty box where an
                arrow should be, silently. A Lucide icon cannot fail that way.
              */}
              <ArrowRight aria-hidden className="size-3.5 shrink-0" />
              {r.module}
            </span>
          </Td>
        </Tr>
      ))}
    </MarketingTable>
  );
}
