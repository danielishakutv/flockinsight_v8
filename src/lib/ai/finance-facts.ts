import "server-only";
import { addMonths, buildCostReport, itemCostInMonth, monthOf, monthRange } from "@/lib/cost-to-serve-shared";
import { loadCostInputs } from "@/lib/cost-to-serve";
import { serialise, type SafePayload } from "./serialiser";
import { isTooThinForFinance, toFinanceFacts } from "./finance-facts-shared";

/**
 * The finance briefing's payload: the last three FINISHED months, with the
 * six before now for the trends. Fixed, whatever range the page shows, so
 * the same day's briefing never depends on who opened which tab.
 */
export async function buildFinancePayload(now = new Date()): Promise<SafePayload | "thin"> {
  const cur = monthOf(now);
  const six = monthRange(addMonths(cur, -6), addMonths(cur, -1));
  const three = six.slice(-3);
  const { input } = await loadCostInputs(six, now);
  const report = buildCostReport({ ...input, months: three, currentMonth: null });
  if (isTooThinForFinance(report)) return "thin";
  const history = buildCostReport({ ...input, months: six, currentMonth: null }).series;
  const dollarCost = input.items
    .filter((i) => i.foreign)
    .reduce((n, i) => n + three.reduce((s, m) => s + itemCostInMonth(i, m), 0), 0);
  return serialise("finance-facts@1", toFinanceFacts(report, history, dollarCost));
}
