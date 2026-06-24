// Currencies a church can pick from for giving. Symbol is a fallback for
// environments where Intl doesn't render one nicely.
export const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  // West Africa
  { code: "NGN", label: "Nigerian Naira (₦)", symbol: "₦" },
  { code: "GHS", label: "Ghanaian Cedi (₵)", symbol: "₵" },
  { code: "XOF", label: "West African CFA franc (CFA)", symbol: "CFA" },
  { code: "SLE", label: "Sierra Leonean Leone (Le)", symbol: "Le" },
  { code: "LRD", label: "Liberian Dollar (L$)", symbol: "L$" },
  { code: "GMD", label: "Gambian Dalasi (D)", symbol: "D" },
  { code: "GNF", label: "Guinean Franc (FG)", symbol: "FG" },
  // East Africa
  { code: "KES", label: "Kenyan Shilling (KSh)", symbol: "KSh" },
  { code: "UGX", label: "Ugandan Shilling (USh)", symbol: "USh" },
  { code: "TZS", label: "Tanzanian Shilling (TSh)", symbol: "TSh" },
  { code: "RWF", label: "Rwandan Franc (FRw)", symbol: "FRw" },
  { code: "ETB", label: "Ethiopian Birr (Br)", symbol: "Br" },
  { code: "SSP", label: "South Sudanese Pound (£)", symbol: "£" },
  // Central Africa
  { code: "XAF", label: "Central African CFA franc (FCFA)", symbol: "FCFA" },
  { code: "CDF", label: "Congolese Franc (FC)", symbol: "FC" },
  { code: "AOA", label: "Angolan Kwanza (Kz)", symbol: "Kz" },
  // Southern Africa
  { code: "ZAR", label: "South African Rand (R)", symbol: "R" },
  { code: "ZMW", label: "Zambian Kwacha (ZK)", symbol: "ZK" },
  { code: "MWK", label: "Malawian Kwacha (MK)", symbol: "MK" },
  { code: "MZN", label: "Mozambican Metical (MT)", symbol: "MT" },
  { code: "BWP", label: "Botswana Pula (P)", symbol: "P" },
  { code: "NAD", label: "Namibian Dollar (N$)", symbol: "N$" },
  { code: "ZWL", label: "Zimbabwean Dollar (Z$)", symbol: "Z$" },
  // North Africa
  { code: "EGP", label: "Egyptian Pound (E£)", symbol: "E£" },
  { code: "MAD", label: "Moroccan Dirham (DH)", symbol: "DH" },
  { code: "DZD", label: "Algerian Dinar (DA)", symbol: "DA" },
  { code: "TND", label: "Tunisian Dinar (DT)", symbol: "DT" },
  // Global
  { code: "USD", label: "US Dollar ($)", symbol: "$" },
  { code: "GBP", label: "British Pound (£)", symbol: "£" },
  { code: "EUR", label: "Euro (€)", symbol: "€" },
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
