// Currencies a church can pick from for giving. Symbol is a fallback for
// environments where Intl doesn't render one nicely.
export const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: "NGN", label: "Nigerian Naira (₦)", symbol: "₦" },
  { code: "USD", label: "US Dollar ($)", symbol: "$" },
  { code: "GBP", label: "British Pound (£)", symbol: "£" },
  { code: "EUR", label: "Euro (€)", symbol: "€" },
  { code: "GHS", label: "Ghanaian Cedi (₵)", symbol: "₵" },
  { code: "KES", label: "Kenyan Shilling (KSh)", symbol: "KSh" },
  { code: "ZAR", label: "South African Rand (R)", symbol: "R" },
  { code: "XOF", label: "West African CFA (CFA)", symbol: "CFA" },
  { code: "XAF", label: "Central African CFA (FCFA)", symbol: "FCFA" },
  { code: "CAD", label: "Canadian Dollar (C$)", symbol: "C$" },
];

export const DEFAULT_CURRENCY = "NGN";

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/** Format an amount as currency, e.g. formatMoney(1500, "NGN") -> "₦1,500.00". */
export function formatMoney(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to symbol + grouped number.
    return `${currencySymbol(currency)}${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

/** Compact format for stat cards, e.g. "₦1.2M". Falls back to full format. */
export function formatMoneyCompact(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatMoney(amount, currency);
  }
}
