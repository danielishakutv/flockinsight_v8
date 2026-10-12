import { z } from "zod";
import { parseMoneyInput, type MoneyParseOptions } from "@/lib/money-input";

/**
 * Zod fields for an amount, read by the platform's one money parser.
 *
 * The schemas these replace did `Number(v.replace(/,/g, ""))`, which saved
 * "1500,50" from a comma-decimal keypad as 150050. Going through
 * parseMoneyInput means a server action reads a figure exactly the way the
 * "Will save …" preview under the field read it, and a figure it cannot read
 * one way only comes back with the parser's own sentence, not "Invalid".
 */
export function zMoney(opts?: MoneyParseOptions) {
  return z.unknown().transform((v, ctx): number => {
    const r = parseMoneyInput(v, opts);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.value;
  });
}

/** The same, where leaving the field empty means "none". */
export function zOptionalMoney(opts?: MoneyParseOptions) {
  return z.unknown().transform((v, ctx): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && v.trim() === "") return null;
    const r = parseMoneyInput(v, opts);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.error });
      return z.NEVER;
    }
    return r.value;
  });
}
