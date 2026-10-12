import { describe, expect, it } from "vitest";
import type { MemberSignup } from "@/db/schema";
import { cleanSignupValues } from "@/lib/member-signup";

/**
 * The public sign-up and self-update forms judge a phone number by the
 * church's own country. Without that, a check of "seven digits or more" let a
 * Nigerian number one digit short through — stored as somebody no text could
 * reach — and seven digits counted as a whole number to match people on.
 */

const signup = { collectChildren: false } as unknown as MemberSignup;
const clean = (phone: string, dial: string) =>
  cleanSignupValues({ firstName: "Ada", phone }, signup, dial);

describe("cleanSignupValues: the phone", () => {
  it("refuses a Nigerian number one digit short", () => {
    const r = clean("0803123456", "234");
    expect(r.ok).toBe(false);
  });

  it("refuses seven stray digits in a Nigerian church", () => {
    expect(clean("8031234", "234").ok).toBe(false);
  });

  it("stores a Nigerian number as E.164", () => {
    const r = clean("0803 123 4567", "234");
    expect(r.ok && r.value.phoneNorm).toBe("+2348031234567");
  });

  it("takes a Mozambican or Kenyan local number in its own church", () => {
    const mz = clean("84 123 4567", "258");
    expect(mz.ok && mz.value.phoneNorm).toBe("+258841234567");
    const ke = clean("0712 345 678", "254");
    expect(ke.ok && ke.value.phoneNorm).toBe("+254712345678");
  });

  it("believes a declared foreign number", () => {
    const r = clean("+44 7911 123456", "234");
    expect(r.ok && r.value.phoneNorm).toBe("+447911123456");
  });

  it("says to include the country code when it refuses", () => {
    const r = clean("12345", "254");
    expect(!r.ok && r.error).toMatch(/country code/);
  });
});
