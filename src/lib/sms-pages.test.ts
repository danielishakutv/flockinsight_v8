import { describe, expect, it } from "vitest";
import { smsEncoding, smsPages, smsUnits } from "@/lib/sms-pages";

describe("smsPages - GSM-7", () => {
  it("fits 160 plain characters on one page and splits at 161", () => {
    expect(smsPages("a".repeat(160))).toBe(1);
    expect(smsPages("a".repeat(161))).toBe(2);
    expect(smsPages("a".repeat(306))).toBe(2);
    expect(smsPages("a".repeat(307))).toBe(3);
  });

  it("counts an extension character as two units", () => {
    expect(smsUnits("€").units).toBe(2);
    expect(smsEncoding("€ { } [ ] ~ ^ | \\")).toBe("gsm7");
    // 159 plain + one € = 161 units: two pages, not one.
    expect(smsPages("a".repeat(159) + "€")).toBe(2);
  });

  it("keeps the GSM accented letters in GSM-7", () => {
    expect(smsEncoding("Café à Zürich, señor Ñoño")).toBe("gsm7");
  });

  it("returns 0 for nothing to send", () => {
    expect(smsPages("")).toBe(0);
    expect(smsPages("   ")).toBe(0);
  });

  it("counts the exact text, spaces included", () => {
    expect(smsPages("a".repeat(158) + "  ")).toBe(1);
    expect(smsPages("a".repeat(159) + "  ")).toBe(2);
  });
});

describe("smsPages - UCS-2", () => {
  it("fits 70 on one page and 67 on each page after that", () => {
    const u = "₦"; // one non-GSM character forces UCS-2
    expect(smsEncoding(u)).toBe("ucs2");
    expect(smsPages(u + "a".repeat(69))).toBe(1); // 70
    expect(smsPages(u + "a".repeat(70))).toBe(2); // 71
    expect(smsPages(u + "a".repeat(133))).toBe(2); // 134
    expect(smsPages(u + "a".repeat(134))).toBe(3); // 135
  });

  it("treats the naira sign, an em dash and a curly quote as UCS-2", () => {
    expect(smsEncoding("Pledge ₦5,000")).toBe("ucs2");
    expect(smsEncoding("Thank you — God bless")).toBe("ucs2");
    expect(smsEncoding("It’s Sunday")).toBe("ucs2");
    expect(smsEncoding("Ẹ ku àárọ̀")).toBe("ucs2");
  });

  it("counts an emoji as two code units", () => {
    expect(smsUnits("🎉").units).toBe(2);
  });

  it("charges the default birthday SMS two pages, not one", () => {
    const birthday =
      "Happy birthday John! 🎉 Everyone at Grace Chapel is celebrating you today. May this new year bring you joy and peace.";
    expect(birthday.length).toBeGreaterThan(70);
    expect(birthday.length).toBeLessThanOrEqual(160);
    expect(smsPages(birthday)).toBe(2);
    // The same words without the emoji are one GSM page.
    expect(smsPages(birthday.replace(" 🎉", ""))).toBe(1);
  });
});
