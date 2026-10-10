import { cn } from "@/lib/utils";

/**
 * A table that is a real table in the markup and a stack of cards on a phone.
 *
 * Both halves of that matter, for different audiences.
 *
 * **For machines:** of every content format measured for whether a search
 * engine's AI layer or an assistant will quote a page, a table with real
 * `<th>` headers and one comparable fact per cell is the strongest. It is the
 * one shape a model can lift without having to interpret a layout. So the
 * markup is `<table><thead><th>` — not a grid of divs that merely looks like a
 * table, which is what most marketing pages ship and which extracts as noise.
 *
 * **For thumbs:** a six-column table on a 360px screen is unreadable whatever
 * you do to it. The usual answer is `overflow-x-auto`, but this project already
 * learned where that leads — the app shell clips horizontal overflow, people do
 * not discover the columns off to the right, and `ScrollableTable` had to be
 * built with fades and a hint line to rescue it. That component is also a
 * client component with a ResizeObserver, and the marketing pages are the ones
 * opened on bad connections, so it is the wrong tool here.
 *
 * Instead the display switches: below `md` each row becomes a block with its
 * column header printed inline beside the value, via `data-label`. Semantics
 * unchanged, no horizontal scroll, no JavaScript.
 */

export function MarketingTable({
  caption,
  columns,
  children,
  className,
}: {
  /**
   * Describes the table. Rendered visibly — a caption is useful to a reader and
   * is also the sentence an assistant uses to decide what the table is OF.
   */
  caption: string;
  columns: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card overflow-hidden rounded-2xl border", className)}>
      {/*
          `block md:table` says in the markup what the rows and cells already
          do: below `md` this is a stack, not a grid, so it has no horizontal
          extent to scroll. `scripts/audit-mobile.mjs` keys off exactly this
          to tell a stacking table apart from one that will be clipped.
        */}
        <table className="block w-full border-collapse text-left md:table">
        <caption className="text-muted-foreground border-b px-5 py-3 text-left text-sm">
          {caption}
        </caption>
        {/*
          Headers are hidden on phones, not removed. The row cells print their
          own label there (see `Td`), so showing the header row as well would
          say everything twice — but a screen reader and a crawler must still
          find real <th> elements, so this is a visual hide only.
        */}
        <thead className="hidden md:table-header-group">
          <tr className="bg-muted/40">
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="px-5 py-3.5 text-sm font-bold tracking-wide"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

/** A row. Becomes a bordered block on a phone, a table row from `md` up. */
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="block px-5 py-4 md:table-row md:px-0 md:py-0">{children}</tr>
  );
}

/**
 * A cell. `label` is the column name, reprinted beside the value on phones
 * where the header row is hidden.
 *
 * Without the label, a stacked row is three unexplained sentences — the
 * "one rendered state meaning several things" problem, in a table.
 */
export function Td({
  label,
  children,
  strong,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  /** The row's subject: bold, and a `<th>` so the row is identifiable. */
  strong?: boolean;
  /** For the column that is deliberately less prominent. */
  muted?: boolean;
}) {
  const Cell = strong ? "th" : "td";
  return (
    <Cell
      scope={strong ? "row" : undefined}
      className={cn(
        "block py-1 text-left align-top text-sm md:table-cell md:px-5 md:py-4",
        strong ? "font-bold md:w-[28%]" : "font-normal",
        muted ? "text-muted-foreground" : "",
        // The column name on phones only. `md:before:content-none` removes it
        // again once the real header row is visible.
        "before:text-muted-foreground before:mr-2 before:text-[11px] before:font-bold before:tracking-wide before:uppercase before:content-[attr(data-label)_':'] md:before:content-none",
      )}
      data-label={label}
    >
      {children}
    </Cell>
  );
}
